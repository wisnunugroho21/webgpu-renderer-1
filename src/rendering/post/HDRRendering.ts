import { createPresentationPipeline } from "./createPresentationPipeline";
import { HDRPostEffects } from "./HDRPostEffects";
import { GPUContext } from "../../gpu/GPUContext";
import { Resources } from "../../gpu/Resources";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";

export type Antialiasing = "none" | "fxaa";
export type ToneMapping = "reinhard" | "clamp" | "filmic";

/** Optional linear scene target. Setup occurs on enable/resize; steady frames only encode. */
export class HDRRendering {
  private readonly effects: HDRPostEffects;
  private postPipeline?: GPURenderPipeline;
  private postLayout?: GPUBindGroupLayout;
  private postGroup?: GPUBindGroup;
  private postRevision = -1;
  private active = false;
  private aa: Antialiasing = "none";
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
  ) {
    this.effects = new HDRPostEffects(gpu, resources);
  }

  get bloomStrength(): number {
    return this.effects.strength;
  }
  set bloomStrength(value: number) {
    this.range(value, 0, 5, "Bloom strength");
    this.effects.strength = value;
    this.prepare();
  }
  get bloomThreshold(): number {
    return this.effects.threshold;
  }
  set bloomThreshold(value: number) {
    this.range(value, 0, 65504, "Bloom threshold");
    this.effects.threshold = value;
  }
  get autoExposure(): boolean {
    return this.effects.automatic;
  }
  set autoExposure(value: boolean) {
    this.effects.automatic = value;
    this.prepare();
  }
  get exposureKey(): number {
    return this.effects.key;
  }
  set exposureKey(value: number) {
    this.range(value, 0.000001, 1, "Exposure key");
    this.effects.key = value;
  }
  get adaptationSpeed(): number {
    return this.effects.speed;
  }
  set adaptationSpeed(value: number) {
    this.range(value, 0, 100, "Exposure adaptation speed");
    this.effects.speed = value;
  }
  get frameDeltaSeconds(): number {
    return this.effects.deltaSeconds;
  }
  set frameDeltaSeconds(value: number) {
    this.range(value, 0, 1, "Exposure frame delta");
    this.effects.deltaSeconds = value;
  }
  private range(value: number, min: number, max: number, name: string): void {
    if (!Number.isFinite(value) || value < min || value > max)
      throw new RangeError(`${name} must be in [${min},${max}]`);
  }
  private get postEnabled(): boolean {
    return this.active && (this.effects.strength > 0 || this.effects.automatic);
  }
  encodeEffects(encoder: GPUCommandEncoder): void {
    if (this.postEnabled) this.effects.encode(encoder);
  }
  get enabled(): boolean {
    return this.active;
  }
  set enabled(value: boolean) {
    this.active = value;
    this.dirty = true;
    this.prepare();
  }
  get antialiasing(): Antialiasing {
    return this.aa;
  }
  set antialiasing(value: Antialiasing) {
    if (value !== "none" && value !== "fxaa")
      throw new RangeError("Unknown anti-aliasing mode");
    this.aa = value;
    this.dirty = true;
    this.prepare();
  }
  /** FXAA can use linear scene storage without enabling HDR exposure/tone mapping. */
  get sceneEnabled(): boolean {
    return this.active || this.aa !== "none";
  }
  private prepare(): void {
    if (this.sceneEnabled && !this.pipeline) {
      this.prepareColor();
      this.buffer = this.resources.buffers.create({
        label: "HDR exposure",
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const presentation = createPresentationPipeline(
        this.gpu,
        this.resources,
        false,
      );
      this.layout = presentation.layout;
      this.pipeline = presentation.pipeline;
    }
    if (this.sceneEnabled)
      this.resize(this.gpu.canvas.width, this.gpu.canvas.height);
    this.prepareEffects();
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
    if (value !== "reinhard" && value !== "clamp" && value !== "filmic")
      throw new RangeError("Unknown tone mapping curve");
    if (value !== this.curve) {
      this.curve = value;
      this.dirty = true;
    }
  }

  resize(width: number, height: number): void {
    if (!this.sceneEnabled || (width === this.width && height === this.height))
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
    this.prepareEffects();
  }

  private prepareEffects(): void {
    if (!this.postEnabled || !this.view) return;
    const device = this.gpu.device;
    if (!this.postPipeline) {
      const presentation = createPresentationPipeline(
        this.gpu,
        this.resources,
        true,
      );
      this.postLayout = presentation.layout;
      this.postPipeline = presentation.pipeline;
    }
    this.effects.prepare(this.width, this.height, this.view);
    if (this.postRevision === this.effects.revision) return;
    this.postRevision = this.effects.revision;
    this.postGroup = device.createBindGroup({
      layout: this.postLayout!,
      entries: [
        { binding: 0, resource: this.view },
        { binding: 1, resource: { buffer: this.buffer! } },
        { binding: 2, resource: this.effects.bloomView },
        { binding: 3, resource: { buffer: this.effects.exposure! } },
        { binding: 4, resource: { buffer: this.effects.buffer! } },
      ],
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    profiler: GPUProfiler,
  ): void {
    if (!this.sceneEnabled) return;
    if (this.dirty) {
      this.params[0] = this.active ? 2 ** this.stops : 1;
      this.params[1] =
        !this.active || this.curve === "clamp"
          ? 1
          : this.curve === "filmic"
            ? 2
            : 0;
      this.params[2] = this.aa === "fxaa" ? 1 : 0;
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
    pass.setPipeline(this.postEnabled ? this.postPipeline! : this.pipeline!);
    pass.setBindGroup(0, this.postEnabled ? this.postGroup! : this.group!);
    pass.draw(3);
    pass.end();
  }
}
