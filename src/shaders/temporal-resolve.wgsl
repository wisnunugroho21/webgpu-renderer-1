struct Settings {
  values: vec4<f32>,
  inverse: mat4x4<f32>,
  previous: mat4x4<f32>,
  jitter: vec4<f32>
}

@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var opaque: texture_2d<f32>;
@group(0) @binding(2) var motion: texture_2d<f32>;
@group(0) @binding(3) var depth: texture_depth_2d;
@group(0) @binding(4) var previous: texture_2d<f32>;
@group(0) @binding(5) var previousDepth: texture_2d<f32>;
@group(0) @binding(6) var<uniform> settings: Settings;
struct Result {
  @location(0) color: vec4<f32>,
  @location(1) depth: f32
}

// Generate a fullscreen triangle without allocating mesh geometry.
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let vertices = array<vec2<f32>, 3>(vec2<f32>(- 1, - 1), vec2<f32>(3, - 1), vec2<f32>(- 1, 3));
  return vec4<f32>(vertices[i], 0, 1);
}

// Transform radiance into a luminance/chroma box for stable neighborhood clipping.
fn ycocg(c: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(dot(c, vec3<f32>(0.25, 0.5, 0.25)), c.r * 0.5 - c.b * 0.5, - c.r * 0.25 + c.g * 0.5 - c.b * 0.25);
}

// Restore linear RGB after history clipping.
fn rgb(c: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

// Reject missing motion, out-of-frame history, depth disocclusion and this frame's transparent contribution.
@fragment fn fs(@builtin(position) position: vec4<f32>) -> Result {
  let pixel = vec2<i32>(position.xy);
  let size = vec2<i32>(textureDimensions(scene));
  let current = textureLoad(scene, pixel, 0);
  var velocity = textureLoad(motion, pixel, 0);
  let currentDepth = textureLoad(depth, pixel, 0);
  // Camera reprojection gives uncovered background its own motion; missing foreground poses remain invalid.
  if velocity.w < 0.5 && currentDepth == 1.0 {
    let clip = vec4<f32>((position.xy / vec2<f32>(size)) * vec2<f32>(2.0, - 2.0) + vec2<f32>(- 1.0, 1.0), 1.0, 1.0);
    let old = settings.previous * settings.inverse * clip;
    if old.w > 0.0 {
      let ndc = old.xyz / old.w;
      let oldUV = ndc.xy * vec2<f32>(0.5, - 0.5) + 0.5;
      velocity = vec4<f32>(position.xy / vec2<f32>(size) - oldUV, ndc.z, 1.0);
    }
  }
  // Accumulate jittered samples on a stable pixel grid; motion retains actual camera/object displacement.
  let uv = (vec2<f32>(pixel) + 0.5) / vec2<f32>(size) - (velocity.xy - settings.jitter.xy);
  var result: Result;
  result.color = current;
  result.depth = textureLoad(depth, pixel, 0);
  let reactive = abs(current.rgb - textureLoad(opaque, pixel, 0).rgb);
  // Persist transparent rejection into the next frame so uncovered background cannot borrow old effects.
  if max(reactive.r, max(reactive.g, reactive.b)) > 0.00001 {
    result.depth = - 1.0;
  }
  if settings.values.x == 0.0 || velocity.w < 0.5 || any(uv < vec2<f32>(0)) || any(uv >= vec2<f32>(1)) || max(reactive.r, max(reactive.g, reactive.b)) > 0.00001 {
    return result;
  }
  let sample = uv * vec2<f32>(size) - 0.5;
  let base = vec2<i32>(floor(sample));
  let fraction = fract(sample);
  var history = vec3<f32>(0);
  var weight = 0.0;
  var colorWeight = 0.0;
  for (var y = 0; y < 2; y++) {
    for (var x = 0; x < 2; x++) {
      let p = clamp(base + vec2<i32>(x, y), vec2<i32>(0), size - 1);
      let d = textureLoad(previousDepth, p, 0).r;
      if d < 0.0 {
        continue;
      }
      let w = select(1.0 - fraction.x, fraction.x, x == 1) * select(1.0 - fraction.y, fraction.y, y == 1);
      history += textureLoad(previous, p, 0).rgb * w;
      colorWeight += w;
      if abs(d - velocity.z) <= settings.values.z {
        weight += w;
      }
    }
  }
  if colorWeight < 0.01 {
    return result;
  }
  history /= colorWeight;
  if weight < 0.01 {
    // Static silhouette coverage changes with jitter even when geometry does not move.
    // Admit neighboring depth support only for stationary valid geometry; moving disocclusions remain rejected.
    if length((velocity.xy - settings.jitter.xy) * vec2<f32>(size)) < 0.01 {
      for (var y = - 1; y <= 1; y++) {
        for (var x = - 1; x <= 1; x++) {
          let p = clamp(pixel + vec2<i32>(x, y), vec2<i32>(0), size - 1);
          let priorDepth = textureLoad(previousDepth, p, 0).r;
          if currentDepth < 1.0 {
            if abs(priorDepth - velocity.z) <= settings.values.z {
              weight = 1.0;
            }
          } else {
            let neighbor = textureLoad(motion, p, 0);
            if neighbor.w > 0.5 && length((neighbor.xy - settings.jitter.xy) * vec2<f32>(size)) < 0.01 && abs(priorDepth - neighbor.z) <= settings.values.z {
              weight = 1.0;
            }
          }
        }
      }
    }
    if weight < 0.01 {
      return result;
    }
  }
  var lo = vec3<f32>(1e30);
  var hi = vec3<f32>(- 1e30);
  for (var y = - 1; y <= 1; y++) {
    for (var x = - 1; x <= 1; x++) {
      let c = ycocg(textureLoad(scene, clamp(pixel + vec2<i32>(x, y), vec2<i32>(0), size - 1), 0).rgb);
      lo = min(lo, c);
      hi = max(hi, c);
    }
  }
  let clipped = rgb(clamp(ycocg(history), lo, hi));
  result.color = vec4<f32>(mix(current.rgb, clipped, settings.values.y * weight), current.a);
  return result;
}
