@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: vec4<f32>;
@vertex fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vertex << 1u) & 2u);
  let y = f32(vertex & 2u);
  return vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  // Load the fully blended linear scene. The sRGB attachment performs encoding once.
  let color = textureLoad(scene, vec2<i32>(position.xy), 0);
  // Half-float overflow is infinity; saturate it to finite radiance before mapping.
  let exposed = clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(65504.0)) * settings.x;
  let mapped = select(exposed / (vec3<f32>(1.0) + exposed), clamp(exposed, vec3<f32>(0.0), vec3<f32>(1.0)), settings.y > 0.5);
  return vec4<f32>(mapped, color.a);
}
