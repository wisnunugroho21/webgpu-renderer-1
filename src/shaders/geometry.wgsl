// CPU ABI: Material is 80 bytes; Instance is 48 bytes (including padding).
// Instance offsets address shared palettes and morph arenas, never per-object buffers.
struct Material {
  baseColor: vec4<f32>,
  surface: vec4<f32>,
  emissive: vec4<f32>,
  params: vec4<f32>,
  uv: vec4<f32>
}

struct Instance {
  transformIndex: u32,
  materialIndex: u32,
  jointOffset: u32,
  jointCount: u32,
  morphWeightOffset: u32,
  morphTargetCount: u32,
  objectId: u32,
  flags: u32,
  morphDeltaOffset: u32,
  morphVertexCount: u32,
  meshId: u32,
  padding: u32
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> transforms: array<mat4x4<f32>>;
@group(0) @binding(2) var<storage, read> materials: array<Material>;
@group(0) @binding(3) var<storage, read> instances: array<Instance>;
@group(0) @binding(4) var<storage, read> joints: array<mat4x4<f32>>;
@group(0) @binding(5) var<storage, read> morphWeights: array<f32>;
@group(0) @binding(6) var<storage, read> morphPositions: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> morphNormals: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read> morphTangents: array<vec4<f32>>;
