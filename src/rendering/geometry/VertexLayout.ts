/** Interleaved asset layout shared by color, depth and shadow pipelines.
 * Joint IDs occupy u32 words in the same buffer as the floating-point attributes. */
export const VERTEX_WORDS = 26;
export const VERTEX_BYTES = VERTEX_WORDS * 4;
export const VertexWord = {
  position: 0,
  color: 3,
  normal: 7,
  uv0: 10,
  tangent: 12,
  uv1: 16,
  joints: 18,
  weights: 22,
} as const;
export const MESH_VERTEX_LAYOUT: GPUVertexBufferLayout[] = [
  {
    arrayStride: VERTEX_BYTES,
    attributes: [
      {
        shaderLocation: 0,
        offset: VertexWord.position * 4,
        format: "float32x3",
      },
      { shaderLocation: 1, offset: VertexWord.color * 4, format: "float32x4" },
      { shaderLocation: 2, offset: VertexWord.normal * 4, format: "float32x3" },
      { shaderLocation: 3, offset: VertexWord.uv0 * 4, format: "float32x2" },
      {
        shaderLocation: 4,
        offset: VertexWord.tangent * 4,
        format: "float32x4",
      },
      { shaderLocation: 5, offset: VertexWord.uv1 * 4, format: "float32x2" },
      { shaderLocation: 6, offset: VertexWord.joints * 4, format: "uint32x4" },
      {
        shaderLocation: 7,
        offset: VertexWord.weights * 4,
        format: "float32x4",
      },
    ],
  },
];
