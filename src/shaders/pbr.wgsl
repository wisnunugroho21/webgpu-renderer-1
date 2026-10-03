// Color entry points share deformation and material storage across all pipeline variants.
// Texture roles control sRGB decoding; fragment calculations and blending use linear color.
@group(1) @binding(0) var baseMap: texture_2d<f32>;
@group(1) @binding(1) var baseSampler: sampler;
@group(1) @binding(2) var mrMap: texture_2d<f32>;
@group(1) @binding(3) var mrSampler: sampler;
@group(1) @binding(4) var normalMap: texture_2d<f32>;
@group(1) @binding(5) var normalSampler: sampler;
@group(1) @binding(6) var aoMap: texture_2d<f32>;
@group(1) @binding(7) var aoSampler: sampler;
@group(1) @binding(8) var emissiveMap: texture_2d<f32>;
@group(1) @binding(9) var emissiveSampler: sampler;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) @interpolate(flat) materialId: u32,
  @location(2) world: vec3<f32>,
  @location(3) normal: vec3<f32>,
  @location(4) uv0: vec2<f32>,
  @location(5) tangent: vec4<f32>,
  @location(6) uv1: vec2<f32>,
}

struct VisibleRecord {
  instance: u32,
  morphDeltaOffset: u32,
  morphVertexCount: u32,
  meshId: u32
}

@group(0) @binding(15) var<storage, read> visibleRecords: array<VisibleRecord>;
fn vertexOutput(p: vec3<f32>, color: vec4<f32>, normal: vec3<f32>, uv0: vec2<f32>, tangent: vec4<f32>, uv1: vec2<f32>, jointIndices: vec4<u32>, weights: vec4<f32>, vertexIndex: u32, info: Instance) -> Output {
  let vertex = deformVertex(LocalVertex(p, normal, tangent), info, vertexIndex, jointIndices, weights, transforms[info.transformIndex]);
  var out: Output;
  out.position = frame.viewProjection * vec4<f32>(vertex.position, 1);
  out.world = vertex.position;
  out.color = color;
  out.materialId = info.materialIndex;
  out.normal = vertex.normal;
  out.tangent = vertex.tangent;
  out.uv0 = uv0;
  out.uv1 = uv1;
  return out;
}

@vertex fn vs(@location(0) p: vec3<f32>, @location(1) color: vec4<f32>, @location(2) normal: vec3<f32>, @location(3) uv0: vec2<f32>, @location(4) tangent: vec4<f32>, @location(5) uv1: vec2<f32>, @location(6) jointIndices: vec4<u32>, @location(7) weights: vec4<f32>, @builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instance: u32) -> Output {
  return vertexOutput(p, color, normal, uv0, tangent, uv1, jointIndices, weights, vertexIndex, instances[instance]);
}

@vertex fn vsIndirect(@location(0) p: vec3<f32>, @location(1) color: vec4<f32>, @location(2) normal: vec3<f32>, @location(3) uv0: vec2<f32>, @location(4) tangent: vec4<f32>, @location(5) uv1: vec2<f32>, @location(6) jointIndices: vec4<u32>, @location(7) weights: vec4<f32>, @builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instance: u32) -> Output {
  let record = visibleRecords[instance];
  if ((record.instance & 0x80000000u) != 0u) {
    var out: Output;
    out.position = vec4<f32>(2, 2, 2, 1);
    return out;
  }
  var info = instances[record.instance];
  info.morphDeltaOffset = record.morphDeltaOffset;
  info.morphVertexCount = record.morphVertexCount;
  info.meshId = record.meshId;
  return vertexOutput(p, color, normal, uv0, tangent, uv1, jointIndices, weights, vertexIndex, info);
}

fn coords(input: Output, index: f32) -> vec2<f32> {
  return select(input.uv0, input.uv1, index == 1.0);
}

@fragment fn fs(input: Output, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  let m = materials[input.materialId];
  let base = m.baseColor * input.color * textureSample(baseMap, baseSampler, coords(input, m.uv.x));
  let mr = textureSample(mrMap, mrSampler, coords(input, m.uv.y));
  let sampledNormal = textureSample(normalMap, normalSampler, coords(input, m.uv.z)).xyz * 2.0 - 1.0;
  let ao = mix(1.0, textureSample(aoMap, aoSampler, coords(input, m.uv.w)).r, m.params.x);
  let emissive = m.emissive.rgb * textureSample(emissiveMap, emissiveSampler, coords(input, m.params.y)).rgb;
  let normalUV = coords(input, m.uv.z);
  let dx = dpdx(input.world);
  let dy = dpdy(input.world);
  let ux = dpdx(normalUV);
  let uy = dpdy(normalUV);
  if m.surface.z == 1.0 && base.a < m.surface.w {
    discard;
  }
  var n = safeNormalize(input.normal);
  if m.params.w == 1.0 && ! front {
    n = - n;
  }
  if m.params.z == 1.0 {
    var t = safeNormalize(input.tangent.xyz - n * dot(n, input.tangent.xyz));
    var b = cross(n, t) * input.tangent.w;
    if dot(t, t) < 0.5 {
      // Tangent-free glTF meshes use the selected normal map UV derivatives.
      let determinant = ux.x * uy.y - ux.y * uy.x;
      if abs(determinant) > 1e-8 {
        t = safeNormalize((dx * uy.y - dy * ux.y) / determinant);
        b = safeNormalize((- dx * uy.x + dy * ux.x) / determinant);
      }
    }
    if dot(t, t) > 0.5 && dot(b, b) > 0.5 {
      n = safeNormalize(mat3x3<f32>(t, b, n) * vec3<f32>(sampledNormal.xy * m.emissive.w, sampledNormal.z));
    }
  }
  var result = base.rgb + emissive;
  if dot(n, n) > 0.5 {
    let metallic = clamp(m.surface.x * mr.b, 0.0, 1.0);
    let roughness = clamp(m.surface.y * mr.g, 0.045, 1.0);
    let v = safeNormalize(frame.eye.xyz - input.world);
    result = directLighting(base.rgb, metallic, roughness, n, v, input.world, input.position.xy) + base.rgb * (1.0 - metallic) * 0.03 * ao + emissive;
  }
  return vec4<f32>(result, select(1.0, base.a, m.surface.z == 2.0));
}
