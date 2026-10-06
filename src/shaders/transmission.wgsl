@group(1) @binding(20) var volumeMaps: texture_2d_array<f32>;
@group(1) @binding(21) var transmissionSampler: sampler;
@group(1) @binding(22) var thicknessSampler: sampler;
@group(0) @binding(18) var transmissionBackground: texture_2d<f32>;
@group(0) @binding(19) var transmissionBackgroundSampler: sampler;
// Fetch linear R transmission/G thickness with independent authored transforms and filtering.
fn volumeFactors(m: Material, input: Output) -> vec2<f32> {
  let uvT = materialUV(m, input.uv0, input.uv1, 10u);
  let uvH = materialUV(m, input.uv0, input.uv1, 11u);
  let tx = dpdx(uvT);
  let ty = dpdy(uvT);
  let hx = dpdx(uvH);
  let hy = dpdy(uvH);
  var factors = vec2<f32>(1.0);
  let flags = u32(m.coat.w);
  if m.transmission.x > 0.0 && (flags & 32u) != 0u {
    factors.x = textureSampleGrad(volumeMaps, transmissionSampler, uvT, 0, tx, ty).r;
  }
  if m.transmission.y > 0.0 && (flags & 64u) != 0u {
    factors.y = textureSampleGrad(volumeMaps, thicknessSampler, uvH, 1, hx, hy).g;
  }
  return factors;
}

// Refract captured opaque radiance through a baked volume and preserve surface/coat reflection.
fn transmissionColor(m: Material, input: Output, factors: vec2<f32>, n: vec3<f32>, v: vec3<f32>, metallic: f32, roughness: f32, fresnel: vec3<f32>, coatF: f32, full: vec3<f32>, reflected: vec3<f32>, base: vec3<f32>) -> vec3<f32> {
  let t = factors.x;
  let h = factors.y;
  let amount = clamp(m.transmission.x * t * (1.0 - metallic), 0.0, 1.0);
  if amount == 0.0 {
    return full;
  }
  let thickness = m.transmission.y * h;
  let eta = select(1.0 / max(m.authored.x, 1.0), 0.0, m.authored.x == 0.0);
  let direction = refract(- v, n, eta);
  if dot(direction, direction) < 0.00001 {
    return full;
  }
  let ray = direction * (thickness / max(abs(dot(direction, n)), 0.1)) * input.volumeScale;
  let destination = frame.viewProjection * vec4<f32>(input.world + ray, 1.0);
  let size = vec2<f32>(textureDimensions(transmissionBackground));
  var uv = input.position.xy / size;
  if thickness > 0.0 && destination.w > 0.0 {
    uv = destination.xy / destination.w * vec2<f32>(0.5, - 0.5) + 0.5;
  }
  let lod = roughness * clamp(m.authored.x * 2.0 - 2.0, 0.0, 1.0) * f32(textureNumLevels(transmissionBackground) - 1u);
  let background = textureSampleLevel(transmissionBackground, transmissionBackgroundSampler, clamp(uv, 0.5 / size, vec2<f32>(1.0) - 0.5 / size), lod).rgb;
  var attenuation = vec3<f32>(1.0);
  // Zero distance encodes glTF's omitted/infinite attenuation distance.
  if m.attenuation.w > 0.0 && thickness > 0.0 {
    attenuation = pow(m.attenuation.rgb, vec3<f32>(length(ray) / m.attenuation.w));
  }
  let transmitted = background * base * attenuation * (vec3<f32>(1.0) - fresnel) * (1.0 - coatF);
  return mix(full, reflected + transmitted, amount);
}
