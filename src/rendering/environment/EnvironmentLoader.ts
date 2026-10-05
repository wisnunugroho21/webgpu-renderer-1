import { contentHash } from "../../assets/contentHash";
import { EnvironmentWorker } from "./EnvironmentWorker";
import { EnvironmentBakeOptions } from "./bakeEnvironment";
import { EnvironmentData } from "./EnvironmentData";
export { decodeEnvironmentPanorama } from "./decodeEnvironmentPanorama";
export type { EnvironmentPanorama } from "./decodeEnvironmentPanorama";
/** Sums retained environment pixel-array byte lengths for decoded-cache accounting. */
function dataBytes(data: EnvironmentData): number {
  return (
    data.diffuse.faces.reduce(
      (n, f) => /** Computes the n + f.byteLength result. */ n + f.byteLength,
      0,
    ) +
    data.specular.reduce(
      (n, l) =>
        /** Computes the n + l.faces.reduce((m, f) => m + f.byteLength, 0) result. */ n +
        l.faces.reduce(
          (m, f) =>
            /** Computes the m + f.byteLength result. */ m + f.byteLength,
          0,
        ),
      0,
    ) +
    data.brdf.pixels.byteLength
  );
}
/** Content-addressed cold CPU bake cache. No device ownership or frame-loop work. */
export class EnvironmentLoader {
  readonly metrics = { hits: 0, bakes: 0, decoded: 0, archives: 0 };
  readonly preparation = new EnvironmentWorker();
  private readonly cache = new Map<string, EnvironmentData>();
  private readonly pending = new Map<string, Promise<EnvironmentData>>();
  private bytes = 0;
  private epoch = 0;
  /** Initializes HDR decoding/baking and bounded content-addressed caching; invalid input is rejected. */
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
  /** Returns the number of prepared environment assets retained by the cache. */
  get size(): number {
    return this.cache.size;
  }
  /** Expose cached bake definitions for cold unique-backing-store memory snapshots. */
  recoverySources(): EnvironmentData[] {
    return [...this.cache.values()];
  }
  /** Returns the retained environment-array byte total for cache-budget accounting. */
  get cachedBytes(): number {
    return this.bytes;
  }
  /** Drops decoded/baked cache ownership and terminates the preparation worker. */
  clear(): void {
    this.epoch++;
    this.preparation.clear();
    this.pending.clear();
    this.cache.clear();
    this.bytes = 0;
  }
  /** Fetches an environment URL with cancellation and prepares archive/HDR data through the bounded loader cache. */
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
  /** Deduplicates content/options preparation and returns a validated linear environment definition. */
  async decode(
    bytes: Uint8Array,
    options: EnvironmentBakeOptions = {},
    signal?: AbortSignal,
  ): Promise<EnvironmentData> {
    signal?.throwIfAborted();
    const source = bytes.slice(),
      hash = await contentHash(source);
    signal?.throwIfAborted();
    const key =
      hash +
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
        // Decodes or bakes the requested environment, publishes it to the cache and enforces its budget.

        const { data: baked, precomputed } = await this.preparation.prepare(
          source,
          options,
        );
        if (precomputed) this.metrics.archives++;
        else {
          this.metrics.decoded++;
          this.metrics.bakes++;
        }
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
        // Removes the completed cache-preparation promise only if it is still the tracked transaction.

        if (this.pending.get(key) === operation) this.pending.delete(key);
      });
      this.pending.set(key, operation);
    }
    data = await operation;
    signal?.throwIfAborted();
    return data;
  }
}
