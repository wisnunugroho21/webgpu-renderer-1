// Copy the depth prepass into the first Hi-Z level.
// Standard Z uses maximum depth so a background cell cannot falsely occlude geometry.
@group(0) @binding(0) var sourceDepth: texture_depth_2d;
@group(0) @binding(1) var destination: texture_storage_2d<r32float, write>;
// Copies camera depth into the first Hi-Z level for conservative maximum-depth reduction.
@compute @workgroup_size(8, 8) fn copyDepth(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(destination);
  if (any(id.xy >= size)) {
    return;
  }
  textureStore(destination, id.xy, vec4<f32>(textureLoad(sourceDepth, vec2<i32>(id.xy), 0)));
}
