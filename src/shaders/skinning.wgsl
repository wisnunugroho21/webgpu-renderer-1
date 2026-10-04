// Four or eight jointly normalized glTF weights blend mesh-local joint matrices.
// Objects without a palette use identity; model placement happens in deformVertex.
fn skinningMatrix(info: Instance, indices: vec4<u32>, weights: vec4<f32>, vertex: u32) -> mat4x4<f32> {
  if (info.jointCount > 0u) {
    var matrix = joints[info.jointOffset + indices.x] * weights.x + joints[info.jointOffset + indices.y] * weights.y + joints[info.jointOffset + indices.z] * weights.z + joints[info.jointOffset + indices.w] * weights.w;
    if ((info.flags & 262144u) != 0u) {
      let offset = info.morphDeltaOffset + info.morphTargetCount * info.morphVertexCount + vertex * 2u;
      let secondary = vec4<u32>(morphTangents[offset]);
      let extraWeights = morphTangents[offset + 1u];
      matrix += joints[info.jointOffset + secondary.x] * extraWeights.x + joints[info.jointOffset + secondary.y] * extraWeights.y + joints[info.jointOffset + secondary.z] * extraWeights.z + joints[info.jointOffset + secondary.w] * extraWeights.w;
    }
    return matrix;
  }
  return mat4x4<f32>(vec4<f32>(1, 0, 0, 0), vec4<f32>(0, 1, 0, 0), vec4<f32>(0, 0, 1, 0), vec4<f32>(0, 0, 0, 1));
}
