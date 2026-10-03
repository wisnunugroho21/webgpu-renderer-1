/** Linear HDR RGBA pixels, face order +X,-X,+Y,-Y,+Z,-Z, rows top to bottom.
 * Diffuse stores irradiance / PI. Specular levels are GGX-filtered at
 * perceptual roughness mip/(levelCount-1), not ordinary downsampled images.
 */
export interface EnvironmentCubeLevel {
  size: number;
  faces: readonly Float32Array[];
}
export interface EnvironmentData {
  diffuse: EnvironmentCubeLevel;
  specular: readonly EnvironmentCubeLevel[];
  /** RG = split-sum Fresnel A/B; X = NdotV, Y = perceptual roughness. */
  brdf: { size: number; pixels: Float32Array };
}
function dimension(size: number, limit: number): void {
  if (!Number.isSafeInteger(size) || size < 1 || size > limit)
    throw new Error("Invalid environment dimensions");
}
function pixels(data: Float32Array, length: number): void {
  if (!(data instanceof Float32Array) || data.length !== length)
    throw new Error("Invalid environment pixels");
  for (const value of data)
    if (!Number.isFinite(value) || value < 0 || value > 65504)
      throw new Error(
        "Environment pixels must be finite linear HDR values in [0,65504]",
      );
}
export function validateEnvironment(data: EnvironmentData, limit = 8192): void {
  const cube = (level: EnvironmentCubeLevel) => {
    dimension(level.size, limit);
    if (level.faces.length !== 6)
      throw new Error("Environment cube requires six faces");
    for (const face of level.faces) pixels(face, level.size * level.size * 4);
  };
  cube(data.diffuse);
  const size = data.specular[0]?.size ?? 0;
  dimension(size, limit);
  if (
    !Number.isInteger(Math.log2(size)) ||
    data.specular.length !== Math.log2(size) + 1
  )
    throw new Error(
      "Environment specular cube requires a complete power-of-two mip chain",
    );
  for (let mip = 0; mip < data.specular.length; mip++) {
    if (data.specular[mip]!.size !== size / 2 ** mip)
      throw new Error("Invalid environment mip size");
    cube(data.specular[mip]!);
  }
  dimension(data.brdf.size, limit);
  pixels(data.brdf.pixels, data.brdf.size * data.brdf.size * 4);
}
/** Float32 -> binary16, round-to-nearest ties-to-even. Cold texture upload only. */
export function packHalf(pixels: Float32Array): Uint16Array {
  const bits = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length);
  const out = new Uint16Array(pixels.length);
  for (let i = 0; i < bits.length; i++) {
    const value = bits[i]!,
      sign = (value >>> 16) & 0x8000;
    const exponent = ((value >>> 23) & 255) - 127;
    if (exponent < -25) {
      out[i] = sign;
      continue;
    }
    if (exponent > 15) {
      out[i] = sign | 0x7c00;
      continue;
    }
    const mantissa = (value & 0x7fffff) | 0x800000;
    const shift = exponent < -14 ? -exponent - 1 : 13;
    const scale = 2 ** shift,
      truncated = Math.floor(mantissa / scale),
      remainder = mantissa % scale;
    const rounded =
      truncated +
      (remainder > scale / 2 || (remainder === scale / 2 && truncated & 1)
        ? 1
        : 0);
    out[i] =
      sign | (exponent < -14 ? rounded : ((exponent + 14) << 10) + rounded);
  }
  return out;
}
