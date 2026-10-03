// Evaluate directional, point, and spot lights in world space.
// Cluster overflow uses the full light list so capacity limits cannot omit illumination.
struct ClusterHeader {
  offset: u32,
  count: u32
}

@group(0) @binding(10) var<storage, read> lightClusterCounts: array<ClusterHeader>;
@group(0) @binding(11) var<storage, read> lightClusterIndices: array<u32>;
@group(0) @binding(9) var<storage, read> lights: array<Light>;
fn directBRDF(base: vec3<f32>, metallic: f32, roughness: f32, n: vec3<f32>, v: vec3<f32>, l: vec3<f32>) -> vec3<f32> {
  let h = safeNormalize(v + l);
  let nv = max(dot(n, v), 0.0);
  let nl = max(dot(n, l), 0.0);
  let nh = max(dot(n, h), 0.0);
  let vh = max(dot(v, h), 0.0);
  let alpha = roughness * roughness;
  let a2 = alpha * alpha;
  let d = a2 / (3.14159265 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let ggxV = nl * sqrt(nv * nv * (1.0 - a2) + a2);
  let ggxL = nv * sqrt(nl * nl * (1.0 - a2) + a2);
  let visibility = 0.5 / max(ggxV + ggxL, 1e-6);
  let f0 = mix(vec3<f32>(.04), base, metallic);
  let f = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - vh, 5.0);
  let diffuse = (vec3<f32>(1.0) - f) * (1.0 - metallic) * base / 3.14159265;
  return(diffuse + d * visibility * f) * nl;
}

fn directLighting(base: vec3<f32>, metallic: f32, roughness: f32, n: vec3<f32>, v: vec3<f32>, position: vec3<f32>, pixel: vec2<f32>) -> vec3<f32> {
  var result = vec3<f32>(0);
  var count = u32(frame.eye.w);
  var start = 0u;
  var clustered = false;
  if ((u32(frame.lighting.z) & 1u) != 0u) {
    let cell = min(vec2<u32>(pixel / frame.cluster.z), vec2<u32>(frame.cluster.xy) - 1u);
    let depth = max(- (frame.view * vec4<f32>(position, 1)).z, frame.lighting.x);
    var slice = (depth - frame.lighting.x) / (frame.lighting.y - frame.lighting.x);
    if ((u32(frame.lighting.z) & 2u) == 0u) {
      slice = log(depth / frame.lighting.x) / log(frame.lighting.y / frame.lighting.x);
    }
    let z = min(u32(max(0.0, slice * frame.cluster.w)), u32(frame.cluster.w) - 1u);
    let index = (z * u32(frame.cluster.y) + cell.y) * u32(frame.cluster.x) + cell.x;
    let candidates = lightClusterCounts[index].count;
    if (candidates <= u32(frame.lighting.w)) {
      count = candidates;
      start = lightClusterCounts[index].offset;
      clustered = true;
    }
  }
  for (var i = 0u; i < count; i++) {
    var id = i;
    if (clustered) {
      id = lightClusterIndices[start + i];
    }
    let light = lights[id];
    var l = - light.direction.xyz;
    var attenuation = 1.0;
    if (light.direction.w > 0.0) {
      let delta = light.position.xyz - position;
      let distance2 = dot(delta, delta);
      l = safeNormalize(delta);
      attenuation = 1.0 / max(distance2, 1e-4);
      if (light.position.w > 0.0) {
        let ratio2 = distance2 / (light.position.w * light.position.w);
        attenuation *= clamp(1.0 - ratio2 * ratio2, 0.0, 1.0);
      }
      if (light.direction.w == 2.0) {
        let cosine = dot(light.direction.xyz, - l);
        let angle = clamp((cosine - light.cone.y) / max(light.cone.x - light.cone.y, 1e-5), 0.0, 1.0);
        attenuation *= angle * angle;
      }
    }
    attenuation *= shadowVisibility(light, position, n);
    result += directBRDF(base, metallic, roughness, n, v, l) * light.color.rgb * light.color.w * attenuation;
  }
  return result;
}
