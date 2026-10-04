@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: vec4<f32>;
// POST_HELPERS
@vertex fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vertex << 1u) & 2u);
  let y = f32(vertex & 2u);
  return vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}

// Loads clamped scene radiance, adds bloom, applies exposure and maps it into linear display range.
fn mappedAt(pixel: vec2<i32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(scene));
  let color = textureLoad(scene, clamp(pixel, vec2<i32>(0), dimensions - vec2<i32>(1)), 0);
  let exposed = (clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(65504.0)) + postRadiance(pixel)) * settings.x * postExposure();
  if (settings.y > 1.5) {
    let filmic = (exposed * (2.51 * exposed + vec3<f32>(0.03))) / (exposed * (2.43 * exposed + vec3<f32>(0.59)) + vec3<f32>(0.14));
    return vec4<f32>(clamp(filmic, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
  }
  let mapped = select(exposed / (vec3<f32>(1.0) + exposed), clamp(exposed, vec3<f32>(0.0), vec3<f32>(1.0)), settings.y > 0.5);
  return vec4<f32>(mapped, color.a);
}

// Bilinearly reconstructs tone-mapped linear color with texture loads for portable FXAA sampling.
fn filteredAt(position: vec2<f32>) -> vec3<f32> {
  // Manual bilinear loads keep half-float filtering portable without new samplers.
  let p = position - vec2<f32>(0.5);
  let base = vec2<i32>(floor(p));
  let f = fract(p);
  return mix(mix(mappedAt(base).rgb, mappedAt(base + vec2<i32>(1, 0)).rgb, f.x), mix(mappedAt(base + vec2<i32>(0, 1)).rgb, mappedAt(base + vec2<i32>(1, 1)).rgb, f.x), f.y);
}

// Computes perceived brightness for local FXAA contrast tests.
fn luma(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
}

// Presents tone-mapped linear color with optional FXAA before the sRGB attachment encodes it.
@fragment fn fs(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  // Filter the mapped linear image; the sRGB attachment encodes display color once.
  let pixel = vec2<i32>(position.xy);
  let center = mappedAt(pixel);
  if (settings.z < 0.5) {
    return center;
  }
  let nw = luma(mappedAt(pixel + vec2<i32>(- 1, - 1)).rgb);
  let ne = luma(mappedAt(pixel + vec2<i32>(1, - 1)).rgb);
  let sw = luma(mappedAt(pixel + vec2<i32>(- 1, 1)).rgb);
  let se = luma(mappedAt(pixel + vec2<i32>(1, 1)).rgb);
  let mid = luma(center.rgb);
  let low = min(mid, min(min(nw, ne), min(sw, se)));
  let high = max(mid, max(max(nw, ne), max(sw, se)));
  if (high - low < max(0.0312, high * 0.125)) {
    return center;
  }
  var direction = vec2<f32>(- ((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  let reduction = max((nw + ne + sw + se) * 0.03125, 0.0078125);
  direction = clamp(direction / (min(abs(direction.x), abs(direction.y)) + reduction), vec2<f32>(- 8.0), vec2<f32>(8.0));
  let a = 0.5 * (filteredAt(position.xy + direction * (- 1.0 / 6.0)) + filteredAt(position.xy + direction * (1.0 / 6.0)));
  let b = a * 0.5 + 0.25 * (filteredAt(position.xy - direction * 0.5) + filteredAt(position.xy + direction * 0.5));
  let brightness = luma(b);
  return vec4<f32>(select(b, a, brightness < low || brightness > high), center.a);
}
