// ABI: nine vec4 spawn fields (144 bytes); motion is analytic and records change only at spawn/retirement.
struct Particle {
  originBirth: vec4<f32>,
  velocityLife: vec4<f32>,
  gravityDrag: vec4<f32>,
  startColor: vec4<f32>,
  endColor: vec4<f32>,
  appearance: vec4<f32>,
  mode: vec4<f32>,
  sprite: vec4<f32>,
  effects: vec4<f32>
}

struct ParticleFrame {
  viewProjection: mat4x4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  clock: vec4<f32>,
  projection: vec4<f32>,
  atlas: vec4<f32>
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> order: array<u32>;
@group(0) @binding(2) var<uniform> frame: ParticleFrame;
struct CurveKey {
  timing: vec4<f32>,
  color: vec4<f32>
}

struct Curve {
  header: vec4<f32>,
  keys: array<CurveKey,
  4>
}

@group(0) @binding(3) var<storage, read> curves: array<Curve>;
@group(0) @binding(4) var atlas: texture_2d<f32>;
@group(0) @binding(5) var atlasSampler: sampler;
@group(0) @binding(6) var sceneDepth: texture_depth_2d;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) @interpolate(flat) shape: u32,
  @location(3) spriteUV: vec2<f32>,
  @location(4) @interpolate(flat) effects: vec2<f32>
}

// Evaluate at most four immutable profile keys; size and RGBA are lifetime multipliers.
fn curveAt(id: u32, t: f32) -> CurveKey {
  if id == 0u {
    // Default procedural particles bypass storage reads and profile interpolation.
    return CurveKey(vec4<f32>(t, 1.0, 0.0, 0.0), vec4<f32>(1.0));
  }
  let curve = curves[id];
  var result = curve.keys[0];
  for (var i = 1u; i < u32(curve.header.x); i++) {
    let next = curve.keys[i];
    if t <= next.timing.x {
      let amount = clamp((t - result.timing.x) / (next.timing.x - result.timing.x), 0.0, 1.0);
      result.timing = mix(result.timing, next.timing, amount);
      result.color = mix(result.color, next.color, amount);
      return result;
    }
    result = next;
  }
  return result;
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
  let curve = curveAt(u32(p.effects.x), t);
  let size = mix(p.appearance.x, p.appearance.y, t) * curve.timing.y * 0.5;
  let world = p.originBirth.xyz + motion + (frame.right.xyz * rotated.x + frame.up.xyz * rotated.y) * size;
  var color = mix(p.startColor, p.endColor, t) * curve.color;
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
  output.spriteUV = vec2<f32>(0.0);
  if p.effects.z > 0.0 {
    let frameAge = select(t * p.sprite.y, age * p.sprite.z, p.sprite.z >= 0.0);
    let number = select(min(floor(frameAge), p.sprite.y - 1.0), floor(frameAge) % p.sprite.y, p.sprite.w > 0.0) + p.sprite.x;
    let tile = vec2<f32>(number % frame.atlas.x, floor(number / frame.atlas.x));
    let inset = 0.5 / (frame.atlas.zw / frame.atlas.xy);
    let uv = mix(inset, vec2<f32>(1.0) - inset, corner * 0.5 + 0.5);
    output.spriteUV = (tile + uv) / frame.atlas.xy;
  }
  output.effects = p.effects.yz;
  return output;
}

// Build a bounded miter in the camera plane; degenerate/reversing tangents fall back safely.
fn ribbonOffset(previous: vec3<f32>, current: vec3<f32>, next: vec3<f32>) -> vec2<f32> {
  let a = current - previous;
  let b = next - current;
  var before = vec2<f32>(dot(a, frame.right.xyz), dot(a, frame.up.xyz));
  var after = vec2<f32>(dot(b, frame.right.xyz), dot(b, frame.up.xyz));
  if length(before) < 0.000001 {
    before = after;
  }
  if length(after) < 0.000001 {
    after = before;
  }
  if length(before) < 0.000001 {
    before = vec2<f32>(1.0, 0.0);
    after = before;
  }
  before = normalize(before);
  after = normalize(after);
  var tangent = before + after;
  if length(tangent) < 0.000001 {
    tangent = after;
  }
  tangent = normalize(tangent);
  let normal = vec2<f32>(- tangent.y, tangent.x);
  let afterNormal = vec2<f32>(- after.y, after.x);
  return normal / max(0.25, abs(dot(normal, afterNormal)));
}

// Expand connected history segments; each endpoint ages independently without CPU vertex animation.
@vertex fn trailVS(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(vec2<f32>(0.0, - 1.0), vec2<f32>(1.0, - 1.0), vec2<f32>(0.0, 1.0), vec2<f32>(0.0, 1.0), vec2<f32>(1.0, - 1.0), vec2<f32>(1.0, 1.0));
  let p = particles[order[instance]];
  let corner = corners[vertex];
  let atEnd = corner.x > 0.5;
  let current = select(p.originBirth.xyz, p.velocityLife.xyz, atEnd);
  let birth = select(p.originBirth.w, p.velocityLife.w, atEnd);
  let previous = select(p.gravityDrag.xyz, p.originBirth.xyz, atEnd);
  let next = select(p.velocityLife.xyz, p.sprite.xyz, atEnd);
  let t = clamp((frame.clock.x - birth) / p.appearance.y, 0.0, 1.0);
  let curve = curveAt(u32(p.effects.x), t);
  let normal = ribbonOffset(previous, current, next) * corner.y * p.appearance.x * curve.timing.y * 0.5;
  let world = current + frame.right.xyz * normal.x + frame.up.xyz * normal.y;
  var output: VertexOutput;
  output.position = frame.viewProjection * vec4<f32>(world, 1.0);
  output.uv = corner;
  output.color = mix(p.startColor, p.endColor, t) * curve.color;
  output.color.a *= 1.0 - t;
  output.shape = 4u;
  output.spriteUV = vec2<f32>(0.0);
  output.effects = vec2<f32>(p.effects.y, 0.0);
  return output;
}

// Clamp each filtered mip independently within its selected atlas tile.
fn atlasMip(uv: vec2<f32>, level: f32) -> vec4<f32> {
  let grid = frame.atlas.xy;
  let tile = floor(uv * grid);
  let inset = 0.5 / (vec2<f32>(textureDimensions(atlas, i32(level))) / grid);
  let local = clamp(fract(uv * grid), inset, vec2<f32>(1.0) - inset);
  return textureSampleLevel(atlas, atlasSampler, (tile + local) / grid, level);
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
  if input.shape == 4u {
    coverage = 1.0 - smoothstep(0.75, 1.0, abs(input.uv.y));
  }
  var lod = 0.0;
  // Uniform feature branch keeps derivatives valid for all fragments, including procedural shapes.
  if frame.clock.y > 1.0 {
    let dimensions = vec2<f32>(textureDimensions(atlas));
    let footprint = max(length(dpdx(input.spriteUV) * dimensions), length(dpdy(input.spriteUV) * dimensions));
    lod = clamp(log2(max(footprint, 1.0)), 0.0, frame.clock.y - 1.0);
  }
  var texel = vec4<f32>(1.0);
  if input.effects.y > 0.0 {
    if frame.clock.y > 1.0 {
      texel = mix(atlasMip(input.spriteUV, floor(lod)), atlasMip(input.spriteUV, ceil(lod)), fract(lod));
    } else {
      texel = textureSampleLevel(atlas, atlasSampler, input.spriteUV, 0.0);
    }
  }
  var fade = 1.0;
  if input.effects.x > 0.0 {
    let depth = textureLoad(sceneDepth, vec2<i32>(input.position.xy), 0);
    if depth < 1.0 {
      var scene = frame.projection.y / (depth + frame.projection.x);
      var particle = frame.projection.y / (input.position.z + frame.projection.x);
      if frame.projection.z > 0.0 {
        scene = (frame.projection.y - depth) / frame.projection.x;
        particle = (frame.projection.y - input.position.z) / frame.projection.x;
      }
      fade = clamp((scene - particle) / input.effects.x, 0.0, 1.0);
    }
  }
  let alpha = input.color.a * texel.a * coverage * fade;
  return vec4<f32>(input.color.rgb * texel.rgb * alpha, alpha);
}
