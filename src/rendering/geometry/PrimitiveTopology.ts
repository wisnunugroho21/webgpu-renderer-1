import { RuntimePrimitive } from "../../assets/gltf/RuntimeAsset";
/** WebGPU uses list topologies here; convert glTF loops, strips and fans once at upload.
 * Alternating strip winding keeps back-face culling consistent with the source asset. */
export function prepareIndices(primitive: RuntimePrimitive, count: number) {
  const source = primitive.indices,
    result: number[] = [];
  if (
    !source.length ||
    (primitive.mode === 1 && source.length % 2) ||
    (primitive.mode === 4 && source.length % 3)
  )
    throw new Error("Invalid primitive index count");
  for (const index of source)
    if (index >= count) throw new Error("Primitive index out of range");
  let topology: 0 | 1 | 2 = 0;
  switch (primitive.mode) {
    case 0:
      topology = 2;
      for (const index of source) result.push(index);
      break;
    case 1:
      topology = 1;
      for (const index of source) result.push(index);
      break;
    case 2:
    case 3:
      topology = 1;
      for (let i = 1; i < source.length; i++)
        result.push(source[i - 1]!, source[i]!);
      if (primitive.mode === 2 && source.length > 1)
        result.push(source[source.length - 1]!, source[0]!);
      break;
    case 4:
      for (const index of source) result.push(index);
      break;
    case 5:
      for (let i = 2; i < source.length; i++)
        result.push(
          source[i - (i % 2 ? 1 : 2)]!,
          source[i - (i % 2 ? 2 : 1)]!,
          source[i]!,
        );
      break;
    case 6:
      for (let i = 2; i < source.length; i++)
        result.push(source[0]!, source[i - 1]!, source[i]!);
      break;
    default:
      throw new Error(`Unsupported primitive mode ${primitive.mode}`);
  }
  if (!result.length) throw new Error("Empty mesh primitive");
  return { topology, indices: new Uint32Array(result) };
}
