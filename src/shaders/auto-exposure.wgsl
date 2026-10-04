struct PostSettings {
  a: vec4<f32>,
  b: vec4<f32>
};
@group(0) @binding(0) var luminance: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> exposure: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> options: PostSettings;
// Adapts persistent GPU exposure toward the bounded log-average luminance target using frame delta seconds.
@compute @workgroup_size(1) fn adapt() {
  let measurement = textureLoad(luminance, vec2<i32>(0), 0).xy;
  let mean = exp2(measurement.x / max(1.0, measurement.y));
  let desiredExposure = clamp(options.b.x / max(0.000001, mean), exp2(options.b.z), exp2(options.b.w));
  let blend = 1.0 - exp(- options.b.y * options.a.w);
  exposure[0].x = mix(exposure[0].x, desiredExposure, blend);
}
