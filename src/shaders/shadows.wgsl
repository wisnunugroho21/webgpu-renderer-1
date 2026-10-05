// Select a directional cascade or local-light face and compare against the shared depth array.
// Receivers and shadow casters use the same morph/skin deformation helpers.
struct ShadowData {
  viewProjection: mat4x4<f32>,
  settings: vec4<f32>
}

@group(0) @binding(12) var<storage, read> shadowData: array<ShadowData>;
@group(0) @binding(13) var shadowMaps: texture_depth_2d_array;
@group(0) @binding(14) var shadowSampler: sampler_comparison;
// Selects a directional cascade, point face or spot layer and averages nine biased comparison samples; outside coverage stays lit.
fn shadowVisibility(light: Light, world: vec3<f32>, normal: vec3<f32>) -> f32 {
  if (light.cone.z == 0.0) {
    return 1.0;
  }
  let depth = - (frame.view * vec4<f32>(world, 1)).z;
  let start = u32(light.cone.z) - 1u;
  let count = u32(light.cone.w);
  var layer = start;
  if light.direction.w == 0.0 {
    for (var c = 0u; c < count; c++) {
      layer = start + c;
      if depth <= shadowData[layer].settings.x {
        break;
      }
    }
    if depth > shadowData[layer].settings.x {
      return 1.0;
    }
  } else {
    let delta = world + normal * shadowData[start].settings.z - light.position.xyz;
    if length(delta) > shadowData[start].settings.x {
      return 1.0;
    }
    if light.direction.w == 1.0 {
      let absolute = abs(delta);
      var axis = 0u;
      if absolute.y > absolute.x {
        axis = 1u;
      }
      if absolute.z > absolute[axis] {
        axis = 2u;
      }
      layer = start + axis * 2u + select(0u, 1u, delta[axis] < 0.0);
    }
  }
  let data = shadowData[layer];
  let p = data.viewProjection * vec4<f32>(world + normal * data.settings.z, 1);
  let ndc = p.xyz / p.w;
  let uv = vec2<f32>(ndc.x * .5 + .5, .5 - ndc.y * .5);
  if (any(uv < vec2<f32>(0)) || any(uv > vec2<f32>(1)) || ndc.z < 0.0 || ndc.z > 1.0) {
    return 1.0;
  }
  let texel = 1.0 / vec2<f32>(textureDimensions(shadowMaps));
  var visible = 0.0;
  for (var y = - 1; y <= 1; y++) {
    for (var x = - 1; x <= 1; x++) {
      visible += textureSampleCompareLevel(shadowMaps, shadowSampler, uv + vec2<f32>(f32(x), f32(y)) * texel, i32(layer), ndc.z - data.settings.y);
    }
  }
  return visible / 9.0;
}
