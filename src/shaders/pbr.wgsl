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
@group(1) @binding(10) var coatMap: texture_2d<f32>;
@group(1) @binding(11) var coatSampler: sampler;
@group(1) @binding(12) var coatRoughMap: texture_2d<f32>;
@group(1) @binding(13) var coatRoughSampler: sampler;
@group(1) @binding(14) var coatNormalMap: texture_2d<f32>;
@group(1) @binding(15) var coatNormalSampler: sampler;
@group(1) @binding(16) var specularMap: texture_2d<f32>;
@group(1) @binding(17) var specularSampler: sampler;
@group(1) @binding(18) var specularColorMap: texture_2d<f32>;
@group(1) @binding(19) var specularColorSampler: sampler;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) @interpolate(flat) materialId: u32,
  @location(2) world: vec3<f32>,
  @location(3) normal: vec3<f32>,
  @location(4) uv0: vec2<f32>,
  @location(5) tangent: vec4<f32>,
  @location(6) uv1: vec2<f32>,
  // VOLUME_VARYING
}

struct VisibleRecord {
  instance: u32,
  morphDeltaOffset: u32,
  morphVertexCount: u32,
  meshId: u32
}

@group(0) @binding(15) var<storage, read> visibleRecords: array<VisibleRecord>;
// Applies shared morph/skin/model deformation and emits clip position plus world-space PBR varyings.
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
  // VOLUME_SCALE
  return out;
}

// Reads the direct instance record and emits shared deformed PBR vertex output.
@vertex fn vs(@location(0) p: vec3<f32>, @location(1) color: vec4<f32>, @location(2) normal: vec3<f32>, @location(3) uv0: vec2<f32>, @location(4) tangent: vec4<f32>, @location(5) uv1: vec2<f32>, @location(6) jointIndices: vec4<u32>, @location(7) weights: vec4<f32>, @builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instance: u32) -> Output {
  return vertexOutput(p, color, normal, uv0, tangent, uv1, jointIndices, weights, vertexIndex, instances[instance]);
}

// Resolves a GPU-visible instance/LOD record, clips invalid transparent slots and emits deformed vertex output.
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

// Selects UV0 or UV1 according to the packed material texture-coordinate index.
fn coords(input: Output, index: f32) -> vec2<f32> {
  return select(input.uv0, input.uv1, index == 1.0);
}

// Samples material maps, applies alpha/normal handling and combines direct, ambient and emissive linear radiance.
@fragment fn fs(input: Output, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  let m = materials[input.materialId];
  let base = m.baseColor * input.color * textureSample(baseMap, baseSampler, materialUV(m, input.uv0, input.uv1, 0u));
  let mr = textureSample(mrMap, mrSampler, materialUV(m, input.uv0, input.uv1, 1u));
  let sampledNormal = textureSample(normalMap, normalSampler, materialUV(m, input.uv0, input.uv1, 2u)).xyz * 2.0 - 1.0;
  let ao = mix(1.0, textureSample(aoMap, aoSampler, materialUV(m, input.uv0, input.uv1, 3u)).r, m.params.x);
  let emissive = m.emissive.rgb * m.authored.z * textureSample(emissiveMap, emissiveSampler, materialUV(m, input.uv0, input.uv1, 4u)).rgb;
  let normalUV = materialUV(m, input.uv0, input.uv1, 2u);
  let dx = dpdx(input.world);
  let dy = dpdy(input.world);
  let ux = dpdx(normalUV);
  let uy = dpdy(normalUV);
  let authoredUV5 = materialUV(m, input.uv0, input.uv1, 5u);
  let ax5 = dpdx(authoredUV5);
  let ay5 = dpdy(authoredUV5);
  let authoredUV6 = materialUV(m, input.uv0, input.uv1, 6u);
  let ax6 = dpdx(authoredUV6);
  let ay6 = dpdy(authoredUV6);
  let authoredUV7 = materialUV(m, input.uv0, input.uv1, 7u);
  let ax7 = dpdx(authoredUV7);
  let ay7 = dpdy(authoredUV7);
  let authoredUV8 = materialUV(m, input.uv0, input.uv1, 8u);
  let ax8 = dpdx(authoredUV8);
  let ay8 = dpdy(authoredUV8);
  let authoredUV9 = materialUV(m, input.uv0, input.uv1, 9u);
  let ax9 = dpdx(authoredUV9);
  let ay9 = dpdy(authoredUV9);
  // VOLUME_FACTORS
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
    if dot(t, t) < 0.5 || m.textureTransforms[4].w == 1.0 || m.textureTransforms[5].w == 1.0 {
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
  if m.authored.w == 1.0 {
    // glTF unlit uses only base color/vertex color/alpha; it ignores emission and lighting.
    return vec4<f32>(base.rgb, select(1.0, base.a, m.surface.z == 2.0));
  }
  let flags = u32(m.coat.w);
  var coatWeight = m.specularCoat.w;
  var coatRoughness = m.coat.x;
  var specularWeight = m.authored.y;
  var specularColor = m.specularCoat.rgb;
  // Explicit gradients preserve mip/anisotropic filtering inside optional-map branches.
  if (flags & 1u) != 0u {
    coatWeight *= textureSampleGrad(coatMap, coatSampler, authoredUV5, ax5, ay5).r;
  }
  if (flags & 2u) != 0u {
    coatRoughness *= textureSampleGrad(coatRoughMap, coatRoughSampler, authoredUV6, ax6, ay6).g;
  }
  if (flags & 8u) != 0u {
    specularWeight *= textureSampleGrad(specularMap, specularSampler, authoredUV8, ax8, ay8).a;
  }
  if (flags & 16u) != 0u {
    specularColor *= textureSampleGrad(specularColorMap, specularColorSampler, authoredUV9, ax9, ay9).rgb;
  }
  var coatNormal = safeNormalize(input.normal);
  if m.params.w == 1.0 && ! front {
    coatNormal = - coatNormal;
  }
  let coatUV = materialUV(m, input.uv0, input.uv1, 7u);
  let cx = ax7;
  let cy = ay7;
  if (flags & 4u) != 0u {
    let sampledCoat = textureSampleGrad(coatNormalMap, coatNormalSampler, coatUV, ax7, ay7).xyz * 2.0 - 1.0;
    var ct = safeNormalize(input.tangent.xyz - coatNormal * dot(coatNormal, input.tangent.xyz));
    var cb = cross(coatNormal, ct) * input.tangent.w;
    if dot(ct, ct) < 0.5 || m.textureTransforms[14].w == 1.0 || m.textureTransforms[15].w == 1.0 {
      let determinant = cx.x * cy.y - cx.y * cy.x;
      if abs(determinant) > 1e-8 {
        ct = safeNormalize((dx * cy.y - dy * cx.y) / determinant);
        cb = safeNormalize((- dx * cy.x + dy * cx.x) / determinant);
      }
    }
    if dot(ct, ct) > 0.5 && dot(cb, cb) > 0.5 {
      coatNormal = safeNormalize(mat3x3<f32>(ct, cb, coatNormal) * vec3<f32>(sampledCoat.xy * m.coat.y, sampledCoat.z));
    }
  }
  if dot(n, n) > 0.5 {
    let metallic = clamp(m.surface.x * mr.b, 0.0, 1.0);
    let roughness = clamp(m.surface.y * mr.g, 0.045, 1.0);
    var v = safeNormalize(frame.eye.xyz - input.world);
    if ((u32(frame.lighting.z) & 2u) != 0u) {
      v = safeNormalize(vec3<f32>(frame.view[0].z, frame.view[1].z, frame.view[2].z));
    }
    let ratio = (m.authored.x - 1.0) / (m.authored.x + 1.0);
    let dielectric = select(select(ratio * ratio, 0.04, m.authored.x == 1.5), 1.0, m.authored.x == 0.0);
    let f0 = mix(min(vec3<f32>(dielectric) * specularColor, vec3<f32>(1.0)) * specularWeight, base.rgb, metallic);
    let extended = m.authored.x != 1.5 || specularWeight != 1.0 || any(specularColor != vec3<f32>(1.0)) || coatWeight > 0.0;
    let lobes = AuthoredLobes(f0, mix(specularWeight, 1.0, metallic), coatNormal, clamp(coatRoughness, 0.045, 1.0), coatWeight, extended);
    let coatF = coatWeight * (0.04 + 0.96 * pow(1.0 - clamp(dot(coatNormal, v), 0.0, 1.0), 5.0));
    result = authoredDirectLighting(base.rgb, metallic, roughness, n, v, input.world, input.position.xy, lobes) + authoredAmbientLighting(base.rgb, metallic, roughness, n, v, ao, lobes) + emissive * (1.0 - coatF);
    // TRANSMISSION_COLOR
  }
  return vec4<f32>(result, select(1.0, base.a, m.surface.z == 2.0));
}
