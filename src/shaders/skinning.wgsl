// Four normalized glTF weights blend mesh-local joint matrices.
// Objects without a palette use identity; model placement happens in deformVertex.
fn skinningMatrix(info: Instance, indices: vec4<u32>, weights: vec4<f32>) -> mat4x4<f32> {
  if (info.jointCount > 0u) {
    return joints[info.jointOffset + indices.x] * weights.x + joints[info.jointOffset + indices.y] * weights.y + joints[info.jointOffset + indices.z] * weights.z + joints[info.jointOffset + indices.w] * weights.w;
  }
  return mat4x4<f32>(vec4<f32>(1, 0, 0, 0), vec4<f32>(0, 1, 0, 0), vec4<f32>(0, 0, 1, 0), vec4<f32>(0, 0, 0, 1));
}
