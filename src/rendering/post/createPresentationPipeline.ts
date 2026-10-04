import { GPUContext } from "../../gpu/GPUContext";
import { Resources } from "../../gpu/Resources";
import shader from "../../shaders/tone-mapping.wgsl?raw";
import postShader from "../../shaders/post-present.wgsl?raw";
const plainHelpers = `
fn postExposure() -> f32 { return 1.0; }
fn postRadiance(pixel: vec2<i32>) -> vec3<f32> { return vec3<f32>(0.0); }
`;
/** Two bounded fullscreen variants. Targets/bind groups stay owned by HDRRendering. */
export function createPresentationPipeline(
  gpu: GPUContext,
  resources: Resources,
  post: boolean,
) {
  const entries: GPUBindGroupLayoutEntry[] = [
    {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "unfilterable-float" },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform", minBindingSize: 16 },
    },
  ];
  if (post)
    entries.push(
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "unfilterable-float" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage", minBindingSize: 16 },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", minBindingSize: 32 },
      },
    );
  const layout = gpu.device.createBindGroupLayout({ entries });
  const module = resources.shaders.get(
    shader.replace("// POST_HELPERS", post ? postShader : plainHelpers),
    post ? "Post presentation" : "Tone mapping",
  );
  const pipeline = resources.pipelines.get({
    label: post ? undefined : "HDR presentation",
    layout: gpu.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: gpu.renderFormat }],
    },
    primitive: { topology: "triangle-list" },
  });
  return { layout, pipeline };
}
