import type { Resources } from "../../gpu/Resources";
import { mipLevelCount } from "./MipGenerator";
/** Cold normalized resampling keeps transmission/thickness in one array binding with independent UV/samplers. */
export class VolumeTexturePacker {
  private readonly layout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  /** Prepare one shared resampling pipeline, independent of authored image sizes or material count. */
  constructor(
    private readonly device: GPUDevice,
    private readonly resources: Resources,
  ) {
    this.layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    });
    this.sampler = resources.samplers.get({
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    const module = resources.shaders.get(
      `
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var sourceSampler:sampler;
struct Output {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>}
// Emit normalized coordinates so each destination mip selects the corresponding authored source footprint.
@vertex fn vs(@builtin(vertex_index) index:u32)->Output {
  let vertices=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));var out:Output;
  out.position=vec4<f32>(vertices[index],0,1);out.uv=vertices[index]*vec2<f32>(0.5,-0.5)+0.5;return out;
}
// GPU sampling supports retained compressed sources without CPU decompression or color-space conversion.
@fragment fn fs(input:Output)->@location(0) vec4<f32> {return textureSample(source,sourceSampler,input.uv);}`,
      "Volume map packing",
    );
    this.pipeline = resources.pipelines.get({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });
  }
  /** Resample two linear maps into separate layers; caller cache owns the returned texture and source leases. */
  pack(
    transmission: GPUTexture | undefined,
    thickness: GPUTexture | undefined,
    white: GPUTextureView,
    samplers?: readonly GPUSampler[],
  ): GPUTexture {
    const width = Math.max(transmission?.width ?? 1, thickness?.width ?? 1),
      height = Math.max(transmission?.height ?? 1, thickness?.height ?? 1);
    const texture = this.resources.textures.create({
      label: "Packed transmission/thickness",
      size: [width, height, 2],
      format: "rgba8unorm",
      mipLevelCount: mipLevelCount(width, height),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC,
    });
    try {
      const encoder = this.device.createCommandEncoder({
        label: "Cold volume map packing",
      });
      for (let layer = 0; layer < 2; layer++) {
        const source = layer === 0 ? transmission : thickness;
        const group = this.device.createBindGroup({
          layout: this.layout,
          entries: [
            { binding: 0, resource: source?.createView() ?? white },
            { binding: 1, resource: samplers?.[layer] ?? this.sampler },
          ],
        });
        for (let level = 0; level < texture.mipLevelCount; level++) {
          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: texture.createView({
                  dimension: "2d",
                  baseArrayLayer: layer,
                  arrayLayerCount: 1,
                  baseMipLevel: level,
                  mipLevelCount: 1,
                }),
                loadOp: "clear",
                storeOp: "store",
              },
            ],
          });
          pass.setPipeline(this.pipeline);
          pass.setBindGroup(0, group);
          pass.draw(3);
          pass.end();
        }
      }
      this.device.queue.submit([encoder.finish()]);
      return texture;
    } catch (error) {
      this.resources.textures.destroy(texture);
      throw error;
    }
  }
}
