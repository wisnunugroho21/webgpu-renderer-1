// Refine current frustum flags with conservative eight-corner projected bounds.
// Keep near-plane intersections visible; maximum Hi-Z depth and bias prevent false rejection.
@group(0) @binding(4) var hiz: texture_2d<f32>;
@compute @workgroup_size(64) fn occlude(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id >= params.count || visible[id] == 0u) {
    return;
  }
  let object = objects[id];
  let center = (frame.view * vec4<f32>(object.boundsCenter, 1)).xyz;
  let radius = object.boundsRadius;
  // A camera/near-plane intersection has unreliable projected bounds: preserve visibility.
  if (- center.z - radius <= frame.lighting.x) {
    return;
  }
  var minimum = vec2<f32>(1);
  var maximum = vec2<f32>(0);
  var nearest = 1.0;
  for (var corner = 0u; corner < 8u; corner++) {
    let sign = vec3<f32>(select(- 1.0, 1.0, (corner & 1u) != 0u), select(- 1.0, 1.0, (corner & 2u) != 0u), select(- 1.0, 1.0, (corner & 4u) != 0u));
    let clip = frame.viewProjection * vec4<f32>(object.boundsCenter + sign * radius, 1);
    if (clip.w <= 0.0 || clip.z <= 0.0) {
      return;
    }
    let ndc = clip.xyz / clip.w;
    let uv = vec2<f32>(ndc.x * .5 + .5, .5 - ndc.y * .5);
    minimum = min(minimum, uv);
    maximum = max(maximum, uv);
    nearest = min(nearest, ndc.z);
  }
  minimum = clamp(minimum, vec2<f32>(0), vec2<f32>(1));
  maximum = clamp(maximum, vec2<f32>(0), vec2<f32>(1));
  let extent = (maximum - minimum) * frame.viewport.xy;
  let level = min(u32(floor(log2(max(1.0, max(extent.x, extent.y))))), textureNumLevels(hiz) - 1u);
  let size = textureDimensions(hiz, level);
  let lo = min(vec2<u32>(minimum * vec2<f32>(size)), size - 1u);
  let hi = min(vec2<u32>(maximum * vec2<f32>(size)), size - 1u);
  var farthest = 0.0;
  // Sample every touched cell, including boundary cells, instead of only the rectangle center.
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) {
      farthest = max(farthest, textureLoad(hiz, vec2<i32>(i32(x), i32(y)), i32(level)).r);
    }
  }
  if (nearest > farthest + 1e-4) {
    visible[id] = 0u;
  }
}
