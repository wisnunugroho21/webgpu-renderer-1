/** CPU/GPU ABI sizes, in 32-bit words and bytes. Keep the matching WGSL structs in sync.
 * Padding is part of the ABI: changing a field requires checking every shader binding. */
export const MATRIX_WORDS = 16;
export const MATRIX_BYTES = MATRIX_WORDS * 4;
export const FRAME_WORDS = 48;
export const FRAME_BYTES = FRAME_WORDS * 4;
export const INSTANCE_WORDS = 12;
export const INSTANCE_BYTES = INSTANCE_WORDS * 4;
export const MATERIAL_WORDS = 20;
export const MATERIAL_BYTES = MATERIAL_WORDS * 4;
export const LIGHT_WORDS = 16;
export const LIGHT_BYTES = LIGHT_WORDS * 4;
export const SHADOW_WORDS = 20;
export const SHADOW_BYTES = SHADOW_WORDS * 4;

/** Matches geometry.wgsl Instance, including its reserved padding word. */
export const InstanceWord = {
  transform: 0,
  material: 1,
  jointOffset: 2,
  jointCount: 3,
  morphWeightOffset: 4,
  morphTargetCount: 5,
  objectId: 6,
  flags: 7,
  morphDeltaOffset: 8,
  morphVertexCount: 9,
  meshId: 10,
  padding: 11,
} as const;
