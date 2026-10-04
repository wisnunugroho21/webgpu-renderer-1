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
