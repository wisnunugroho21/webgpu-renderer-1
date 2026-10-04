@group(0) @binding(0) var<uniform> inverseVP: mat4x4<f32>;
@group(1) @binding(0) var<uniform> environment: vec4<f32>;
@group(1) @binding(2) var radiance: texture_cube<f32>;
@group(1) @binding(4) var radianceSampler: sampler;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) clip: vec2<f32>,
}

@vertex fn vs(@builtin(vertex_index) vertex: u32) -> Output {
  let clip = vec2<f32>(f32((vertex << 1u) & 2u), f32(vertex & 2u)) * 2.0 - 1.0;
  return Output(vec4<f32>(clip, 1.0, 1.0), clip);
}

@fragment fn fs(input: Output) -> @location(0) vec4<f32> {
  // Translation cancels between projected near/far points, also for orthographic cameras.
  let near = inverseVP * vec4<f32>(input.clip, 0.0, 1.0);
  let far = inverseVP * vec4<f32>(input.clip, 1.0, 1.0);
  let direction = normalize(far.xyz / far.w - near.xyz / near.w);
  let rotated = vec3<f32>(environment.z * direction.x - environment.w * direction.z, direction.y, environment.w * direction.x + environment.z * direction.z);
  return vec4<f32>(textureSampleLevel(radiance, radianceSampler, rotated, 0.0).rgb * environment.x, 1.0);
}
