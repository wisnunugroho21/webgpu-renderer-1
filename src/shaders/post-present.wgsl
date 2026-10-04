struct PostSettings {
  a: vec4<f32>,
  b: vec4<f32>
};
@group(0) @binding(2) var bloom: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> exposureState: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> post: PostSettings;
// Returns the GPU adaptation gain only when automatic exposure is enabled.
fn postExposure() -> f32 {
  return select(1.0, exposureState[0].x, post.a.z > 0.5);
}

// Loads one clamped bloom mip texel without requiring half-float filtering support.
fn bloomAt(pixel: vec2<i32>, level: i32) -> vec3<f32> {
  let dimensions = vec2<i32>(textureDimensions(bloom, level));
  return textureLoad(bloom, clamp(pixel, vec2<i32>(0), dimensions - vec2<i32>(1)), level).rgb;
}

// Bilinearly combines bounded bloom mip levels and applies the configured bloom strength.
fn postRadiance(pixel: vec2<i32>) -> vec3<f32> {
  if (post.a.y <= 0.0) {
    return vec3<f32>(0.0);
  }
  let uv = (vec2<f32>(pixel) + vec2<f32>(0.5)) / vec2<f32>(textureDimensions(scene));
  let levels = textureNumLevels(bloom);
  var color = vec3<f32>(0.0);
  for (var level = 0u; level < levels; level++) {
    let p = uv * vec2<f32>(textureDimensions(bloom, level)) - vec2<f32>(0.5);
    let base = vec2<i32>(floor(p));
    let f = fract(p);
    color += mix(mix(bloomAt(base, i32(level)), bloomAt(base + vec2<i32>(1, 0), i32(level)), f.x), mix(bloomAt(base + vec2<i32>(0, 1), i32(level)), bloomAt(base + vec2<i32>(1, 1), i32(level)), f.x), f.y);
  }
  return color * post.a.y / f32(levels);
}
