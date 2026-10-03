import { Resources } from "../../gpu/Resources";
/** Area-weighted downsampling, including odd dimensions, in the texture's linear space. */
export class MipGenerator {
  private readonly layout: GPUBindGroupLayout;
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  passes = 0;
  constructor(
    private readonly device: GPUDevice,
    resources: Resources,
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
    const module = resources.shaders.get(
      `
      @group(0) @binding(0) var source:texture_2d<f32>;
      @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32> {
        let positions=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));
        return vec4<f32>(positions[i],0,1);
      }
      @fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32> {
        let size=textureDimensions(source);let destination=max(size/2u,vec2<u32>(1u));
        let ratio=vec2<f32>(size)/vec2<f32>(destination);
        let lo=floor(p.xy)*ratio;let hi=(floor(p.xy)+1.0)*ratio;
        let first=vec2<i32>(floor(lo));let end=vec2<i32>(ceil(hi));
        var sum=vec4<f32>(0);var area=0.0;
        for(var y=first.y;y<end.y;y++) { for(var x=first.x;x<end.x;x++) {
          let lower=max(lo,vec2<f32>(f32(x),f32(y)));
          let upper=min(hi,vec2<f32>(f32(x+1),f32(y+1)));
          let weight=max(upper.x-lower.x,0.0)*max(upper.y-lower.y,0.0);
          sum+=textureLoad(source,vec2<i32>(x,y),0)*weight;area+=weight;
        }}
        return sum/max(area,1e-8);
      }`,
      "Area mipmaps",
    );
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [this.layout],
    });
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
  generate(texture: GPUTexture): void {
    if (texture.mipLevelCount < 2) return;
    const pipeline = this.pipelines.get(texture.format);
    if (!pipeline) throw new Error("Unsupported mipmap format");
    const encoder = this.device.createCommandEncoder({
      label: "Asset mipmaps",
    });
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const source = texture.createView({
        baseMipLevel: level - 1,
        mipLevelCount: 1,
      });
      const target = texture.createView({
        baseMipLevel: level,
        mipLevelCount: 1,
      });
      const group = this.device.createBindGroup({
        layout: this.layout,
        entries: [{ binding: 0, resource: source }],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      this.passes++;
    }
    this.device.queue.submit([encoder.finish()]);
  }
}
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
