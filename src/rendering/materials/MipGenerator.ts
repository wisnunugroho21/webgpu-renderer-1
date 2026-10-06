import { Resources } from "../../gpu/Resources";
export interface MipChain {
  /** Encode retained downsample passes without allocating GPU objects or submitting. */
  encode(encoder: GPUCommandEncoder): void;
}
/** Area-weighted downsampling, including odd dimensions, in the texture's linear space. */
export class MipGenerator {
  private readonly layout: GPUBindGroupLayout;
  private readonly alphaPipelines = new Map<
    GPUTextureFormat,
    GPURenderPipeline
  >();
  private readonly module: GPUShaderModule;
  private readonly pipelineLayout: GPUPipelineLayout;
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  passes = 0;
  /** Initializes shared linear/sRGB downsampling pipelines. */
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
      ],
    });
    const module = (this.module = resources.shaders.get(
      `
      @group(0) @binding(0) var source:texture_2d<f32>;
      // Emits an oversized fullscreen triangle from vertex IDs without a vertex buffer.
      @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32> {
        let positions=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));
        return vec4<f32>(positions[i],0,1);
      }
      // Area-weights covered source texels, including odd dimensions, and outputs linear downsampled color.
      fn downsample(p:vec4<f32>, alphaWeighted:bool)->vec4<f32> {
        let size=textureDimensions(source);let destination=max(size/2u,vec2<u32>(1u));
        let ratio=vec2<f32>(size)/vec2<f32>(destination);
        let lo=floor(p.xy)*ratio;let hi=(floor(p.xy)+1.0)*ratio;
        let first=vec2<i32>(floor(lo));let end=vec2<i32>(ceil(hi));
        var sum=vec4<f32>(0);var area=0.0;
        for(var y=first.y;y<end.y;y++) { for(var x=first.x;x<end.x;x++) {
          let lower=max(lo,vec2<f32>(f32(x),f32(y)));
          let upper=min(hi,vec2<f32>(f32(x+1),f32(y+1)));
          let weight=max(upper.x-lower.x,0.0)*max(upper.y-lower.y,0.0);
          var color=textureLoad(source,vec2<i32>(x,y),0);
          if alphaWeighted {color=vec4<f32>(color.rgb*color.a,color.a);}
          sum+=color*weight;area+=weight;
        }}
        if alphaWeighted {return vec4<f32>(sum.rgb/max(sum.a,1e-8),sum.a/max(area,1e-8));}
        return sum/max(area,1e-8);
      }
      // Preserve the existing linear area filter for ordinary material textures.
      @fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32> {return downsample(p,false);}
      // Exclude invisible RGB from straight-alpha particle downsampling.
      @fragment fn fsAlpha(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32> {return downsample(p,true);}`,
      "Area mipmaps",
    ));
    const layout = (this.pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.layout],
    }));
    for (const format of ["rgba8unorm", "rgba8unorm-srgb"] as const) {
      this.pipelines.set(
        format,
        resources.pipelines.get({
          layout,
          vertex: { module, entryPoint: "vs" },
          fragment: { module, entryPoint: "fs", targets: [{ format }] },
          primitive: { topology: "triangle-list" },
        }),
      );
    }
  }
  /** Prepare views/groups once for a retained mip chain, including linear half-float scene captures. */
  prepare(texture: GPUTexture, alphaWeighted = false): MipChain {
    const pipelines = alphaWeighted ? this.alphaPipelines : this.pipelines;
    let pipeline = pipelines.get(texture.format);
    if (!pipeline) {
      if (
        !["rgba8unorm", "rgba8unorm-srgb", "rgba16float"].includes(
          texture.format,
        )
      )
        throw new Error("Unsupported mipmap format");
      pipeline = this.resources.pipelines.get({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vs" },
        fragment: {
          module: this.module,
          entryPoint: alphaWeighted ? "fsAlpha" : "fs",
          targets: [{ format: texture.format }],
        },
        primitive: { topology: "triangle-list" },
      });
      pipelines.set(texture.format, pipeline);
    }
    const passes: {
      descriptor: GPURenderPassDescriptor;
      group: GPUBindGroup;
    }[] = [];
    for (let layer = 0; layer < (texture.depthOrArrayLayers ?? 1); layer++)
      for (let level = 1; level < texture.mipLevelCount; level++) {
        const source = texture.createView({
          dimension: "2d",
          baseArrayLayer: layer,
          arrayLayerCount: 1,
          baseMipLevel: level - 1,
          mipLevelCount: 1,
        });
        const target = texture.createView({
          dimension: "2d",
          baseArrayLayer: layer,
          arrayLayerCount: 1,
          baseMipLevel: level,
          mipLevelCount: 1,
        });
        const group = this.device.createBindGroup({
          layout: this.layout,
          entries: [{ binding: 0, resource: source }],
        });
        passes.push({
          group,
          descriptor: {
            label: "Retained mip downsample",
            colorAttachments: [
              {
                view: target,
                loadOp: "clear",
                storeOp: "store",
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
              },
            ],
          },
        });
      }
    return {
      encode: (encoder) => {
        // Reuse immutable views/groups/descriptors and the shared format pipeline every frame.
        for (const prepared of passes) {
          const pass = encoder.beginRenderPass(prepared.descriptor);
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, prepared.group);
          pass.draw(3);
          pass.end();
          this.passes++;
        }
      },
    };
  }
  /** Upload-time convenience: prepare and submit one chain on the cold material/atlas path. */
  generate(texture: GPUTexture, alphaWeighted = false): void {
    if (texture.mipLevelCount < 2) return;
    const chain = this.prepare(texture, alphaWeighted),
      encoder = this.device.createCommandEncoder({ label: "Asset mipmaps" });
    chain.encode(encoder);
    this.device.queue.submit([encoder.finish()]);
  }
}
/** Returns the full mip-chain level count down to a 1×1 texture. */
export function mipLevelCount(width: number, height: number): number {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("Invalid texture size");
  return 1 + Math.floor(Math.log2(Math.max(width, height)));
}
