import type { Accessor } from "@gltf-transform/core";
/** Copy accessor values after library normalization; decoded arrays never alias parser storage. */
export function readAccessor(accessor: Accessor | null): Float32Array {
  if (!accessor) return new Float32Array(0);
  const size = accessor.getElementSize(),
    out = new Float32Array(accessor.getCount() * size),
    element: number[] = [];
  for (let i = 0; i < accessor.getCount(); i++) {
    accessor.getElement(i, element);
    for (let j = 0; j < size; j++) out[i * size + j] = element[j]!;
  }
  return out;
}
