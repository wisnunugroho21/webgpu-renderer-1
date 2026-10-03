import { Resources } from "../../gpu/Resources";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";
import copyShader from "../../shaders/hiz.wgsl?raw";
import reduceShader from "../../shaders/hiz-reduce.wgsl?raw";
import debugShader from "../../shaders/hiz-debug.wgsl?raw";
/** Standard Z [0,1], max-depth reduction. Optional until visibility consumes it. */
export class HiZPyramid {
  enabled = false;
  debugEnabled = false;
  debugMip = 0;
  texture?: GPUTexture;
  readonly views: GPUTextureView[] = [];
  readonly widths: number[] = [];
  readonly heights: number[] = [];
  private readonly groups: GPUBindGroup[] = [];
  private readonly debugGroups: GPUBindGroup[] = [];
  private readonly copyLayout: GPUBindGroupLayout;
  private readonly reduceLayout: GPUBindGroupLayout;
  private readonly debugLayout: GPUBindGroupLayout;
  private readonly copyPipeline: GPUComputePipeline;
  private readonly reducePipeline: GPUComputePipeline;
  private readonly debugPipeline: GPURenderPipeline;
  levels = 0;
  passes = 0;
  private width = 0;
  private height = 0;
  constructor(
    private readonly device: GPUDevice,
    private readonly resources: Resources,
    format: GPUTextureFormat,
  ) {
    const entries: GPUBindGroupLayoutEntry[] = [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "depth" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "r32float" },
      },
    ];
    this.copyLayout = device.createBindGroupLayout({ entries });
    this.reduceLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
        entries[1]!,
      ],
    });
    this.debugLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
      ],
    });
    this.copyPipeline = resources.pipelines.getCompute({
      label: "Hi-Z copy depth",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.copyLayout],
      }),
      compute: {
        module: resources.shaders.get(copyShader),
        entryPoint: "copyDepth",
      },
    });
    this.reducePipeline = resources.pipelines.getCompute({
      label: "Hi-Z max reduction",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.reduceLayout],
      }),
      compute: {
        module: resources.shaders.get(reduceShader),
        entryPoint: "reduceDepth",
      },
    });
    const module = resources.shaders.get(debugShader);
    this.debugPipeline = resources.pipelines.get({
      label: "Hi-Z debug view",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.debugLayout],
      }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
  }
  resize(width: number, height: number, depth: GPUTextureView): void {
    if (width === this.width && height === this.height) return;
    if (this.texture) this.resources.textures.destroy(this.texture);
    this.width = width;
    this.height = height;
    this.levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    this.texture = this.resources.textures.create({
      label: "Standard-Z max depth pyramid",
      size: [width, height],
      mipLevelCount: this.levels,
      format: "r32float",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.views.length =
      this.groups.length =
      this.debugGroups.length =
      this.widths.length =
      this.heights.length =
        0;
    for (let level = 0; level < this.levels; level++) {
      const view = this.texture.createView({
        baseMipLevel: level,
        mipLevelCount: 1,
      });
      this.views.push(view);
      this.widths.push(Math.max(1, width >> level));
      this.heights.push(Math.max(1, height >> level));
      this.groups.push(
        this.device.createBindGroup({
          layout: level ? this.reduceLayout : this.copyLayout,
          entries: [
            { binding: 0, resource: level ? this.views[level - 1]! : depth },
            { binding: 1, resource: view },
          ],
        }),
      );
      this.debugGroups.push(
        this.device.createBindGroup({
          layout: this.debugLayout,
          entries: [{ binding: 0, resource: view }],
        }),
      );
    }
  }
  encode(encoder: GPUCommandEncoder, profiler?: GPUProfiler): void {
    this.passes = 0;
    if (!this.enabled && !this.debugEnabled) return;
    // Isolated mip passes provide explicit storage-write -> sampled-read usage transitions.
    for (let level = 0; level < this.levels; level++) {
      const pass = encoder.beginComputePass({
        label: "Hi-Z mip",
        timestampWrites: profiler?.writes(GPUPass.hiz),
      });
      pass.setPipeline(level ? this.reducePipeline : this.copyPipeline);
      pass.setBindGroup(0, this.groups[level]!);
      pass.dispatchWorkgroups(
        Math.ceil(this.widths[level]! / 8),
        Math.ceil(this.heights[level]! / 8),
      );
      pass.end();
      this.passes++;
    }
  }
  debug(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    if (!this.debugEnabled) return;
    const level = Math.max(
      0,
      Math.min(this.levels - 1, Math.floor(this.debugMip)),
    );
    const pass = encoder.beginRenderPass({
      label: "Hi-Z debug",
      colorAttachments: [{ view, loadOp: "load", storeOp: "store" }],
    });
    pass.setPipeline(this.debugPipeline);
    pass.setBindGroup(0, this.debugGroups[level]!);
    pass.draw(3);
    pass.end();
  }
}
