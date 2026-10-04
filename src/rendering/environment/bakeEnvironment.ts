import {
  EnvironmentCubeLevel,
  EnvironmentData,
  validateEnvironment,
} from "./EnvironmentData";
export type EnvironmentSampler = (
  direction: Float64Array,
  rgb: Float64Array,
) => void;
export interface EnvironmentBakeOptions {
  specularSize?: number;
  diffuseSize?: number;
  brdfSize?: number;
  samples?: number;
}
/** Reverses base-two bits to produce a deterministic low-discrepancy sample coordinate. */
function radicalInverse(index: number): number {
  let value = 0,
    fraction = 0.5;
  while (index) {
    value += (index & 1) * fraction;
    index >>>= 1;
    fraction *= 0.5;
  }
  return value;
}
/** WebGPU cube lookup convention, including image-space downward Y. */
export function cubeDirection(
  face: number,
  u: number,
  v: number,
  out: Float64Array,
): void {
  switch (face) {
    case 0:
      out.set([1, -v, -u]);
      break;
    case 1:
      out.set([-1, -v, u]);
      break;
    case 2:
      out.set([u, 1, v]);
      break;
    case 3:
      out.set([u, -1, -v]);
      break;
    case 4:
      out.set([u, -v, 1]);
      break;
    case 5:
      out.set([-u, -v, -1]);
      break;
    default:
      throw new Error("Invalid cube face");
  }
  const length = Math.hypot(out[0]!, out[1]!, out[2]!);
  for (let i = 0; i < 3; i++) out[i] = out[i]! / length;
}
/** Builds a GGX importance-sampled half vector from roughness and a low-discrepancy sample. */
function halfVector(
  u: number,
  v: number,
  roughness: number,
  out: Float64Array,
): void {
  const a2 = roughness ** 4;
  const z = Math.sqrt((1 - v) / (1 + (a2 - 1) * v));
  const radius = Math.sqrt(Math.max(0, 1 - z * z)),
    angle = 2 * Math.PI * u;
  out[0] = radius * Math.cos(angle);
  out[1] = radius * Math.sin(angle);
  out[2] = z;
}
/** Offline/cold Monte Carlo preprocessing. Do not call from an update hook.
 * The GGX split-sum uses correlated Smith visibility, matching directBRDF.
 * Higher resolutions/sample counts are an asset quality choice, not a frame cost.
 */
export function bakeEnvironment(
  sample: EnvironmentSampler,
  options: EnvironmentBakeOptions = {},
): EnvironmentData {
  const specularSize = options.specularSize ?? 32,
    diffuseSize = options.diffuseSize ?? 8,
    brdfSize = options.brdfSize ?? 32,
    samples = options.samples ?? 128;
  for (const size of [specularSize, diffuseSize, brdfSize])
    if (!Number.isSafeInteger(size) || size < 1 || size > 512)
      throw new Error("Invalid bake size (1–512)");
  if (
    !Number.isInteger(Math.log2(specularSize)) ||
    !Number.isSafeInteger(samples) ||
    samples < 1 ||
    samples > 65536
  )
    throw new Error("Invalid environment bake settings");
  const normal = new Float64Array(3),
    direction = new Float64Array(3),
    local = new Float64Array(3),
    color = new Float64Array(3);
  /** Applies color.fill, sample to read. */
  const read = () => {
    color.fill(NaN);
    sample(direction, color);
    for (const value of color)
      if (!Number.isFinite(value) || value < 0 || value > 65504)
        throw new Error("Invalid environment radiance");
  };
  /** Builds a record containing size, faces. */
  const cube = (
    size: number,
    roughness: number,
    diffuse: boolean,
  ): EnvironmentCubeLevel => {
    const faces: Float32Array[] = [];
    for (let face = 0; face < 6; face++) {
      const pixels = new Float32Array(size * size * 4);
      faces.push(pixels);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          cubeDirection(
            face,
            ((x + 0.5) * 2) / size - 1,
            ((y + 0.5) * 2) / size - 1,
            normal,
          );
          const nx = normal[0]!,
            ny = normal[1]!,
            nz = normal[2]!;
          // Tangent basis remains valid at both poles.
          const length =
            Math.abs(nz) < 0.999 ? Math.hypot(nx, ny) : Math.hypot(ny, nz);
          const tx = Math.abs(nz) < 0.999 ? -ny / length : 0,
            ty = Math.abs(nz) < 0.999 ? nx / length : -nz / length,
            tz = Math.abs(nz) < 0.999 ? 0 : ny / length;
          const bx = ny * tz - nz * ty,
            by = nz * tx - nx * tz,
            bz = nx * ty - ny * tx;
          let red = 0,
            green = 0,
            blue = 0,
            weight = 0;
          const count = !diffuse && roughness === 0 ? 1 : samples;
          for (let s = 0; s < count; s++) {
            const u = (s + 0.5) / samples,
              v = radicalInverse(s);
            if (diffuse) {
              const radius = Math.sqrt(v),
                angle = 2 * Math.PI * u;
              local[0] = radius * Math.cos(angle);
              local[1] = radius * Math.sin(angle);
              local[2] = Math.sqrt(1 - v);
            } else halfVector(u, v, roughness, local);
            let lx = local[0]!,
              ly = local[1]!,
              lz = local[2]!;
            if (!diffuse) {
              lx *= 2 * lz;
              ly *= 2 * lz;
              lz = 2 * lz * lz - 1;
            }
            if (lz <= 0) continue;
            direction[0] = tx * lx + bx * ly + nx * lz;
            direction[1] = ty * lx + by * ly + ny * lz;
            direction[2] = tz * lx + bz * ly + nz * lz;
            read();
            const w = diffuse ? 1 : lz;
            red += color[0]! * w;
            green += color[1]! * w;
            blue += color[2]! * w;
            weight += w;
          }
          const offset = (y * size + x) * 4;
          pixels[offset] = red / weight;
          pixels[offset + 1] = green / weight;
          pixels[offset + 2] = blue / weight;
          pixels[offset + 3] = 1;
        }
    }
    return { size, faces };
  };
  const levels = Math.log2(specularSize) + 1;
  const specular = Array.from({ length: levels }, (_, mip) =>
    /** Delegates this operation to cube. */ cube(
      specularSize / 2 ** mip,
      levels === 1 ? 0 : mip / (levels - 1),
      false,
    ),
  );
  const pixels = new Float32Array(brdfSize * brdfSize * 4);
  for (let y = 0; y < brdfSize; y++)
    for (let x = 0; x < brdfSize; x++) {
      const nv = (x + 0.5) / brdfSize,
        roughness = (y + 0.5) / brdfSize,
        vx = Math.sqrt(1 - nv * nv),
        a2 = roughness ** 4;
      let a = 0,
        b = 0;
      for (let s = 0; s < samples; s++) {
        halfVector((s + 0.5) / samples, radicalInverse(s), roughness, local);
        const vh = Math.max(0, vx * local[0]! + nv * local[2]!),
          nl = 2 * vh * local[2]! - nv;
        if (nl <= 0) continue;
        const visibility =
          0.5 /
          (nl * Math.sqrt(nv * nv * (1 - a2) + a2) +
            nv * Math.sqrt(nl * nl * (1 - a2) + a2));
        const factor = (4 * visibility * vh * nl) / local[2]!,
          fresnel = (1 - vh) ** 5;
        a += (1 - fresnel) * factor;
        b += fresnel * factor;
      }
      const offset = (y * brdfSize + x) * 4;
      pixels[offset] = a / samples;
      pixels[offset + 1] = b / samples;
      pixels[offset + 3] = 1;
    }
  const result = {
    diffuse: cube(diffuseSize, 0, true),
    specular,
    brdf: { size: brdfSize, pixels },
  };
  validateEnvironment(result);
  return result;
}

/** Bilinear linear-RGB panorama adapter: top = +Y, center = +X, quarter = -Z.
 * Decoding HDR/EXR/KTX files is an upstream asset task; no implicit sRGB decoding.
 */
export function panoramaSampler(
  width: number,
  height: number,
  pixels: Float32Array,
): EnvironmentSampler {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    pixels.length !== width * height * 3
  )
    throw new Error("Invalid RGB panorama");
  for (const value of pixels)
    if (!Number.isFinite(value) || value < 0 || value > 65504)
      throw new Error("Invalid panorama radiance");
  return (direction, out) => {
    // Maps a world direction into equirectangular panorama coordinates and samples linear radiance.

    const x =
      (0.5 + Math.atan2(direction[2]!, direction[0]!) / (2 * Math.PI)) * width -
      0.5;
    const y = Math.max(
      0,
      Math.min(
        height - 1,
        (Math.acos(Math.max(-1, Math.min(1, direction[1]!))) / Math.PI) *
          height -
          0.5,
      ),
    );
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    const left = ((ix % width) + width) % width,
      right = (left + 1) % width,
      bottom = Math.min(height - 1, iy + 1);
    for (let c = 0; c < 3; c++) {
      const top =
        pixels[(iy * width + left) * 3 + c]! * (1 - fx) +
        pixels[(iy * width + right) * 3 + c]! * fx;
      const below =
        pixels[(bottom * width + left) * 3 + c]! * (1 - fx) +
        pixels[(bottom * width + right) * 3 + c]! * fx;
      out[c] = top * (1 - fy) + below * fy;
    }
  };
}
