import { GPUContext } from "../../gpu/GPUContext";
import { Resources } from "../../gpu/Resources";
import reduceShader from "../../shaders/post-reduce.wgsl?raw";
import exposureShader from "../../shaders/auto-exposure.wgsl?raw";
export interface PostReduction {
  layout: GPUBindGroupLayout;
  first: GPUComputePipeline;
  reduce: GPUComputePipeline;
}
/** Cold shader variants share the reduction kernel. Summed log luminance retains sample counts; bloom averages. */
export function createPostReduction(
  gpu: GPUContext,
  resources: Resources,
  format: GPUTextureFormat,
  luma: boolean,
): PostReduction {
  const device = gpu.device;
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: "write-only", format },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform", minBindingSize: 32 },
      },
    ],
  });
  const source = reduceShader
    .replaceAll("OUTPUT_FORMAT", format)
    .replace(
      "// EXTRACT_VALUE",
      luma
        ? `let rgb = clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(65504.0));
             let luminance = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
             return vec4<f32>(log2(max(0.000001, luminance)), 1.0, 0.0, 0.0);`
        : `let rgb = clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(65504.0));
             return vec4<f32>(max(vec3<f32>(0.0), rgb - vec3<f32>(options.a.x)), 1.0);`,
    )
    .replace(
      "// STORE_FIRST",
      `textureStore(outputImage,vec2<i32>(id.xy),${luma ? "sum" : "sum/max(count,1.0)"});`,
    )
    .replace(
      "// STORE_REDUCE",
      `textureStore(outputImage,vec2<i32>(id.xy),${luma ? "sum" : "sum/max(count,1.0)"});`,
    );
  const module = resources.shaders.get(
      source,
      luma ? "Luminance reduction" : "Bloom reduction",
    ),
    pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [layout],
    });
  return {
    layout,
    first: resources.pipelines.getCompute({
      layout: pipelineLayout,
      compute: { module, entryPoint: "first" },
    }),
    reduce: resources.pipelines.getCompute({
      layout: pipelineLayout,
      compute: { module, entryPoint: "reduce" },
    }),
  };
}

/** Adaptation state remains GPU-owned; this factory builds only its reusable pipeline/layout. */
export function createExposureAdaptation(
  device: GPUDevice,
  resources: Resources,
) {
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "unfilterable-float" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage", minBindingSize: 16 },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform", minBindingSize: 32 },
      },
    ],
  });
  const pipeline = resources.pipelines.getCompute({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [layout],
    }),
    compute: {
      module: resources.shaders.get(exposureShader, "Exposure adaptation"),
      entryPoint: "adapt",
    },
  });
  return { layout, pipeline };
}
