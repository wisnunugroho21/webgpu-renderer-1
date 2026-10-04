// Stable surface contract for custom linear RGB shading. Alpha and geometry stay renderer-owned.
struct MaterialSurface {
  baseColor: vec4<f32>,
  emissive: vec3<f32>,
  metallic: f32,
  normal: vec3<f32>,
  roughness: f32,
  worldPosition: vec3<f32>,
  occlusion: f32,
  viewDirection: vec3<f32>,
  materialId: u32,
  uv0: vec2<f32>,
  uv1: vec2<f32>,
  screenPosition: vec2<f32>
}

struct MaterialShaderParameters {
  values: array<vec4<f32>,
  4>
}

@group(0) @binding(16) var<storage, read> materialShaderParameters: array<MaterialShaderParameters>;
