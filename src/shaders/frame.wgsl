// CPU ABI: FrameUniforms packs 48 f32 words (192 bytes); eye.w stores light count.
// lighting.z: bit 0 enables clustering; bit 1 selects orthographic camera math.
// Matrices are column-major; clip depth uses WebGPU zero-to-one standard Z.
struct Frame {
  viewProjection: mat4x4<f32>,
  eye: vec4<f32>,
  view: mat4x4<f32>,
  cluster: vec4<f32>,
  lighting: vec4<f32>,
  viewport: vec4<f32>
}

struct Light {
  position: vec4<f32>,
  color: vec4<f32>,
  direction: vec4<f32>,
  cone: vec4<f32>
}
