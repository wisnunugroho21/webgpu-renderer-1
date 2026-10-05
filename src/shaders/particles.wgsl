// ABI: seven vec4 spawn fields (112 bytes); motion is analytic and records change only at spawn/retirement.
struct Particle {
  originBirth: vec4<f32>,
  velocityLife: vec4<f32>,
  gravityDrag: vec4<f32>,
  startColor: vec4<f32>,
  endColor: vec4<f32>,
  appearance: vec4<f32>,
  mode: vec4<f32>
}

struct ParticleFrame {
  viewProjection: mat4x4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  clock: vec4<f32>
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> order: array<u32>;
@group(0) @binding(2) var<uniform> frame: ParticleFrame;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) @interpolate(flat) shape: u32
}

// Evaluate one spawn record at the shared clock, then expand a rotated camera-facing quad.
// instance_index includes firstInstance, so additive draws address their suffix in the order table.
@vertex fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(vec2<f32>(- 1.0, - 1.0), vec2<f32>(1.0, - 1.0), vec2<f32>(- 1.0, 1.0), vec2<f32>(- 1.0, 1.0), vec2<f32>(1.0, - 1.0), vec2<f32>(1.0, 1.0));
  let p = particles[order[instance]];
  let age = max(0.0, frame.clock.x - p.originBirth.w);
  let t = clamp(age / p.velocityLife.w, 0.0, 1.0);
  var motion = p.velocityLife.xyz * age + p.gravityDrag.xyz * (0.5 * age * age);
  let drag = p.gravityDrag.w;
  // Integrate exponential velocity damping plus constant gravity analytically.
  // The small-drag ballistic branch avoids subtractive cancellation; CPU depth sorting matches it.
  if drag > 0.0001 {
    let integral = (1.0 - exp(- drag * age)) / drag;
    motion = p.velocityLife.xyz * integral + p.gravityDrag.xyz * ((age - integral) / drag);
  }
  let angle = p.appearance.z + age * p.appearance.w;
  let corner = corners[vertex];
  let rotated = vec2<f32>(corner.x * cos(angle) - corner.y * sin(angle), corner.x * sin(angle) + corner.y * cos(angle));
  let size = mix(p.appearance.x, p.appearance.y, t) * 0.5;
  let world = p.originBirth.xyz + motion + (frame.right.xyz * rotated.x + frame.up.xyz * rotated.y) * size;
  var color = mix(p.startColor, p.endColor, t);
  var fade = 1.0;
  if p.mode.z > 0.0 {
    fade *= clamp(t / p.mode.z, 0.0, 1.0);
  }
  if p.mode.w > 0.0 {
    fade *= clamp((1.0 - t) / p.mode.w, 0.0, 1.0);
  }
  color.a *= fade;
  var output: VertexOutput;
  output.position = frame.viewProjection * vec4<f32>(world, 1.0);
  output.uv = corner;
  output.color = color;
  output.shape = u32(p.mode.x);
  return output;
}

// Convert procedural coverage and lifetime alpha into premultiplied linear radiance.
// Alpha uses one/one-minus-src-alpha; additive uses one/one. Render state tests depth without writing it.
@fragment fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
  let radius = length(input.uv);
  var coverage = 1.0;
  if input.shape == 0u {
    coverage = 1.0 - smoothstep(0.85, 1.0, radius);
  }
  if input.shape == 1u {
    coverage = pow(max(0.0, 1.0 - radius * radius), 2.0);
  }
  if input.shape == 2u {
    coverage = smoothstep(0.65, 0.8, radius) * (1.0 - smoothstep(0.85, 1.0, radius));
  }
  let alpha = input.color.a * coverage;
  return vec4<f32>(input.color.rgb * alpha, alpha);
}
