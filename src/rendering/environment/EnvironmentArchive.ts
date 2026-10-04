import { EnvironmentData, validateEnvironment } from "./EnvironmentData";
const MAGIC = 0x564e4557,
  HEADER = 24;
/** Checks the archive magic before selecting the prepared-environment decoder. */
export function isEnvironmentArchive(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= HEADER &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      0,
      true,
    ) === MAGIC
  );
}
/** Versioned little-endian float32 bakes avoid parser/convolution work at runtime. */
export function encodeEnvironmentArchive(data: EnvironmentData): Uint8Array {
  validateEnvironment(data, 512);
  const arrays = [
    ...data.diffuse.faces,
    ...data.specular.flatMap(
      (level) => /** Returns level faces. */ level.faces,
    ),
    data.brdf.pixels,
  ];
  const count = arrays.reduce(
      (sum, array) =>
        /** Computes the sum + array.length result. */ sum + array.length,
      0,
    ),
    bytes = new Uint8Array(HEADER + count * 4);
  const view = new DataView(bytes.buffer);
  [
    MAGIC,
    1,
    data.diffuse.size,
    data.specular[0]!.size,
    data.brdf.size,
    count,
  ].forEach((value, index) =>
    /** Delegates this operation to view.setUint32. */ view.setUint32(
      index * 4,
      value,
      true,
    ),
  );
  let offset = HEADER;
  for (const array of arrays)
    for (const value of array) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
  return bytes;
}
/** Validates archive headers/dimensions and restores the linear HDR cube/LUT arrays. */
export function decodeEnvironmentArchive(bytes: Uint8Array): EnvironmentData {
  if (!isEnvironmentArchive(bytes))
    throw new Error("Invalid environment archive");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 1)
    throw new Error("Unsupported environment archive version");
  const diffuse = view.getUint32(8, true),
    specular = view.getUint32(12, true),
    brdf = view.getUint32(16, true),
    count = view.getUint32(20, true);
  if (
    [diffuse, specular, brdf].some(
      (size) =>
        /** Evaluates the size < 1 || size > 512 condition. */ size < 1 ||
        size > 512,
    ) ||
    !Number.isInteger(Math.log2(specular))
  )
    throw new Error("Invalid environment archive dimensions");
  let expected = diffuse * diffuse * 24 + brdf * brdf * 4;
  for (let size = specular; size >= 1; size /= 2) expected += size * size * 24;
  if (count !== expected || bytes.byteLength !== HEADER + expected * 4)
    throw new Error("Invalid environment archive length");
  const pixels = new Float32Array(count);
  for (let i = 0; i < count; i++)
    pixels[i] = view.getFloat32(HEADER + i * 4, true);
  let offset = 0;
  /** Builds a record containing size, faces. */
  const cube = (size: number) => ({
    size,
    faces: Array.from({ length: 6 }, () => {
      // Returns face.

      const face = pixels.subarray(offset, offset + size * size * 4);
      offset += face.length;
      return face;
    }),
  });
  const diffuseData = cube(diffuse),
    levels = [];
  for (let size = specular; size >= 1; size /= 2) levels.push(cube(size));
  const data = {
    diffuse: diffuseData,
    specular: levels,
    brdf: { size: brdf, pixels: pixels.subarray(offset) },
  };
  validateEnvironment(data, 512);
  return data;
}
