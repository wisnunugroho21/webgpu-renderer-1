import { RuntimePrimitive } from "../../assets/gltf/RuntimeAsset";
/** Split triangle corners only when glTF omits normals; all morph/skin attributes follow the split. */
export function withFlatNormals(primitive: RuntimePrimitive): RuntimePrimitive {
  const count = primitive.attributes.POSITION!.length / 3;
  // glTF requires flat normals when NORMAL is absent. Split triangle vertices
  // once at upload, preserving every attribute and morph target correspondence.
  const src = primitive.indices,
    triangles: number[] = [];
  if (primitive.mode === 4) {
    if (src.length % 3) throw new Error("Invalid primitive index count");
    for (const index of src) triangles.push(index);
  } else if (primitive.mode === 5) {
    for (let i = 2; i < src.length; i++)
      triangles.push(
        src[i - (i % 2 ? 1 : 2)]!,
        src[i - (i % 2 ? 2 : 1)]!,
        src[i]!,
      );
  } else if (primitive.mode === 6) {
    for (let i = 2; i < src.length; i++)
      triangles.push(src[0]!, src[i - 1]!, src[i]!);
  } else throw new Error(`Unsupported primitive mode ${primitive.mode}`);
  for (const index of triangles)
    if (index >= count) throw new Error("Primitive index out of range");
  const expand = (attributes: Record<string, Float32Array>) =>
    Object.fromEntries(
      Object.entries(attributes).map(([name, data]) => {
        const stride = data.length / count;
        if (!Number.isInteger(stride))
          throw new Error("Invalid mesh attribute size");
        const expanded = new Float32Array(triangles.length * stride);
        for (let i = 0; i < triangles.length; i++)
          expanded.set(
            data.subarray(triangles[i]! * stride, (triangles[i]! + 1) * stride),
            i * stride,
          );
        return [name, expanded];
      }),
    );
  const attributes = expand(primitive.attributes),
    p = attributes.POSITION!,
    normal = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3]! - p[i]!,
      uy = p[i + 4]! - p[i + 1]!,
      uz = p[i + 5]! - p[i + 2]!;
    const vx = p[i + 6]! - p[i]!,
      vy = p[i + 7]! - p[i + 1]!,
      vz = p[i + 8]! - p[i + 2]!;
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (let j = 0; j < 3; j++) normal.set(n, i + j * 3);
  }
  attributes.NORMAL = normal;
  return {
    ...primitive,
    attributes,
    targets: primitive.targets.map(expand),
    mode: 4,
    indices: Uint32Array.from(triangles, (_, i) => i),
  };
}
