import { GPUContext } from "../../gpu/GPUContext";
import { Resources } from "../../gpu/Resources";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";
import shader from "../../shaders/tone-mapping.wgsl?raw";

export type ToneMapping = "reinhard" | "clamp";

/** Optional linear scene target. Setup occurs on enable/resize; steady frames only encode. */
export class HDRRendering {
  private active = false;
  private stops = 0;
  private curve: ToneMapping = "reinhard";
  private dirty = true;
  private readonly params = new Float32Array(4);
  private buffer?: GPUBuffer;
  private layout?: GPUBindGroupLayout;
  private pipeline?: GPURenderPipeline;
  private group?: GPUBindGroup;
  private texture?: GPUTexture;
  view?: GPUTextureView;
  private width = 0;
  private height = 0;

  constructor(
    private readonly gpu: GPUContext,
    private readonly resources: Resources,
    private readonly prepareColor: () => void,
  ) {}

  get enabled(): boolean {
    return this.active;
  }
  set enabled(value: boolean) {
    if (value && !this.pipeline) {
      this.prepareColor();
      const device = this.gpu.device;
      this.buffer = this.resources.buffers.create({
        label: "HDR exposure",
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.layout = device.createBindGroupLayout({
        entries: [
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
        ],
      });
      const module = this.resources.shaders.get(shader, "Tone mapping");
      this.pipeline = this.resources.pipelines.get({
        label: "HDR presentation",
        layout: device.createPipelineLayout({
          bindGroupLayouts: [this.layout],
        }),
        vertex: { module, entryPoint: "vs" },
        fragment: {
          module,
          entryPoint: "fs",
          targets: [{ format: this.gpu.renderFormat }],
        },
        primitive: { topology: "triangle-list" },
      });
    }
    this.active = value;
    if (value) this.resize(this.gpu.canvas.width, this.gpu.canvas.height);
  }

  /** Exposure in stops: +1 doubles linear radiance before tone mapping. */
  get exposure(): number {
    return this.stops;
  }
  set exposure(value: number) {
    if (!Number.isFinite(value) || Math.abs(value) > 16)
      throw new RangeError(
        "HDR exposure must be finite and between -16 and 16 stops",
      );
    if (value !== this.stops) {
      this.stops = value;
      this.dirty = true;
    }
  }
  get toneMapping(): ToneMapping {
    return this.curve;
  }
  set toneMapping(value: ToneMapping) {
    if (value !== "reinhard" && value !== "clamp")
      throw new RangeError("Unknown tone mapping curve");
    if (value !== this.curve) {
      this.curve = value;
      this.dirty = true;
    }
  }

  resize(width: number, height: number): void {
    if (!this.active || (width === this.width && height === this.height))
      return;
    if (this.texture) this.resources.textures.destroy(this.texture);
    this.width = width;
    this.height = height;
    this.texture = this.resources.textures.create({
      label: "Linear HDR scene",
      size: [width, height],
      format: "rgba16float",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.view = this.texture.createView();
    this.group = this.gpu.device.createBindGroup({
      layout: this.layout!,
      entries: [
        { binding: 0, resource: this.view },
        { binding: 1, resource: { buffer: this.buffer! } },
      ],
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    profiler: GPUProfiler,
  ): void {
    if (!this.active) return;
    if (this.dirty) {
      this.params[0] = 2 ** this.stops;
      this.params[1] = this.curve === "reinhard" ? 0 : 1;
      this.gpu.queue.writeBuffer(this.buffer!, 0, this.params);
      this.dirty = false;
    }
    const pass = encoder.beginRenderPass({
      label: "Tone mapping",
      timestampWrites: profiler.writes(GPUPass.toneMapping),
      colorAttachments: [
        { view, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
      ],
    });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, this.group!);
    pass.draw(3);
    pass.end();
  }
}
