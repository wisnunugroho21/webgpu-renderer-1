import {
  bakeEnvironment,
  EnvironmentBakeOptions,
  panoramaSampler,
} from "./bakeEnvironment";
import { EnvironmentData } from "./EnvironmentData";
export interface EnvironmentPanorama {
  width: number;
  height: number;
  pixels: Float32Array;
}

/** Decode files only: Three's cold parsers do not participate in scene/render ownership. */
export async function decodeEnvironmentPanorama(
  bytes: Uint8Array,
): Promise<EnvironmentPanorama> {
  const buffer = bytes.slice().buffer,
    { FloatType } = await import("three");
  const exr =
    bytes[0] === 0x76 &&
    bytes[1] === 0x2f &&
    bytes[2] === 0x31 &&
    bytes[3] === 0x01;
  const parsed = exr
    ? new (await import("three/addons/loaders/EXRLoader.js")).EXRLoader()
        .setDataType(FloatType)
        .parse(buffer)
    : new (await import("three/addons/loaders/HDRLoader.js")).HDRLoader()
        .setDataType(FloatType)
        .parse(buffer);
  const { width, height, data } = parsed;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 16777216 ||
    !(data instanceof Float32Array) ||
    data.length !== width * height * 4
  )
    throw new Error("Invalid or oversized HDR panorama");
  const chroma = exr
    ? (parsed as { header?: { chromaticities?: Record<string, number> } })
        .header?.chromaticities
    : undefined;
  if (chroma)
    for (const [key, value] of Object.entries({
      redX: 0.64,
      redY: 0.33,
      greenX: 0.3,
      greenY: 0.6,
      blueX: 0.15,
      blueY: 0.06,
      whiteX: 0.3127,
      whiteY: 0.329,
    }))
      if (
        Math.abs((chroma[key] ?? NaN) - value) > 1e-4 ||
        !Number.isFinite(chroma[key])
      )
        throw new Error(
          "Environment EXR primaries must be linear sRGB/Rec.709",
        );
  const pixels = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        // EXRLoader stores rows bottom-up; HDRLoader stores the file's -Y rows top-down.
        const value = data[((exr ? height - 1 - y : y) * width + x) * 4 + c]!;
        if (!Number.isFinite(value))
          throw new Error("Non-finite environment radiance");
        // Radiance RGBE uses a 256 denominator; the upstream HDR parser uses 255.
        pixels[(y * width + x) * 3 + c] = Math.max(
          0,
          Math.min(65504, exr ? value : value * (255 / 256)),
        );
      }
  return { width, height, pixels };
}
function dataBytes(data: EnvironmentData): number {
  return (
    data.diffuse.faces.reduce((n, f) => n + f.byteLength, 0) +
    data.specular.reduce(
      (n, l) => n + l.faces.reduce((m, f) => m + f.byteLength, 0),
      0,
    ) +
    data.brdf.pixels.byteLength
  );
}
/** Content-addressed cold CPU bake cache. No device ownership or frame-loop work. */
export class EnvironmentLoader {
  readonly metrics = { hits: 0, bakes: 0, decoded: 0 };
  private readonly cache = new Map<string, EnvironmentData>();
  private readonly pending = new Map<string, Promise<EnvironmentData>>();
  private bytes = 0;
  private epoch = 0;
  constructor(
    readonly maxEntries = 8,
    readonly maxBytes = 64 * 1024 * 1024,
  ) {
    if (
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 0 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 0
    )
      throw new Error("Invalid environment cache budget");
  }
  get size(): number {
    return this.cache.size;
  }
  get cachedBytes(): number {
    return this.bytes;
  }
  clear(): void {
    this.epoch++;
    this.pending.clear();
    this.cache.clear();
    this.bytes = 0;
  }
  async load(
    url: string,
    options: EnvironmentBakeOptions = {},
    signal?: AbortSignal,
  ): Promise<EnvironmentData> {
    const response = await fetch(url, { signal });
    if (!response.ok)
      throw new Error(`Environment fetch failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 64 * 1024 * 1024)
      throw new Error("Environment file exceeds 64 MiB");
    return this.decode(bytes, options, signal);
  }
  async decode(
    bytes: Uint8Array,
    options: EnvironmentBakeOptions = {},
    signal?: AbortSignal,
  ): Promise<EnvironmentData> {
    signal?.throwIfAborted();
    const source = bytes.slice(),
      digest = await crypto.subtle.digest("SHA-256", source);
    signal?.throwIfAborted();
    const key =
      Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("") +
      ":" +
      JSON.stringify([
        options.specularSize ?? 32,
        options.diffuseSize ?? 8,
        options.brdfSize ?? 32,
        options.samples ?? 128,
      ]);
    let data = this.cache.get(key);
    if (data) {
      this.metrics.hits++;
      this.cache.delete(key);
      this.cache.set(key, data);
      return data;
    }
    let operation = this.pending.get(key);
    if (operation) this.metrics.hits++;
    else {
      const epoch = this.epoch;
      operation = (async () => {
        const panorama = await decodeEnvironmentPanorama(source);
        this.metrics.decoded++;
        const baked = bakeEnvironment(
          panoramaSampler(panorama.width, panorama.height, panorama.pixels),
          options,
        );
        this.metrics.bakes++;
        const size = dataBytes(baked);
        if (epoch === this.epoch && this.maxEntries && size <= this.maxBytes) {
          this.cache.set(key, baked);
          this.bytes += size;
          while (
            this.cache.size > this.maxEntries ||
            this.bytes > this.maxBytes
          ) {
            const oldest = this.cache.keys().next().value!;
            this.bytes -= dataBytes(this.cache.get(oldest)!);
            this.cache.delete(oldest);
          }
        }
        return baked;
      })().finally(() => {
        if (this.pending.get(key) === operation) this.pending.delete(key);
      });
      this.pending.set(key, operation);
    }
    data = await operation;
    signal?.throwIfAborted();
    return data;
  }
}
