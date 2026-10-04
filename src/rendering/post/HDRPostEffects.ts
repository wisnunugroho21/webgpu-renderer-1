import {
  createPostReduction,
  createExposureAdaptation,
  type PostReduction,
} from "./createPostPipelines";
import { GPUContext } from "../../gpu/GPUContext";
import { Resources } from "../../gpu/Resources";
interface Level {
  width: number;
  height: number;
  view: GPUTextureView;
  texture: GPUTexture;
  group: GPUBindGroup;
}
/** Optional bounded GPU-only radiance processing. Allocation and group construction are cold. */
export class HDRPostEffects {
  revision = 0;
  strength = 0;
  threshold = 1;
  automatic = false;
  key = 0.18;
  speed = 3;
  minStops = -8;
  maxStops = 8;
  deltaSeconds = 1 / 60;
  private bloom?: GPUTexture;
  private readonly luminance: Level[] = [];
  private readonly bloomLevels: Level[] = [];
  private bloomReduction?: PostReduction;
  private lumaReduction?: PostReduction;
  private adaptPipeline?: GPUComputePipeline;
  private adaptLayout?: GPUBindGroupLayout;
  private adaptGroup?: GPUBindGroup;
  private source?: GPUTextureView;
  private width = 0;
  private height = 0;
  private fallback?: GPUTexture;
  buffer?: GPUBuffer;
  exposure?: GPUBuffer;
  private readonly settings = new Float32Array(8);
  private readonly nextSettings = new Float32Array(8);
  /** Initializes bounded bloom/luminance pyramids and GPU exposure adaptation. */
  constructor(
    private readonly gpu: GPUContext,
    private readonly resources: Resources,
  ) {}
  /** Delegates this operation to (this.bloom ?? this.fallback)!.createView. */
  get bloomView(): GPUTextureView {
    return (this.bloom ?? this.fallback)!.createView();
  }
  /** Called from explicit feature setters/resize, never lazily from encode. */
  prepare(width: number, height: number, source: GPUTextureView): void {
    const device = this.gpu.device;
    let changed = false;
    if (!this.buffer) {
      this.buffer = this.resources.buffers.create({
        label: "Post effects settings",
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.exposure = this.resources.buffers.create({
        label: "GPU exposure state",
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.gpu.queue.writeBuffer(
        this.exposure,
        0,
        new Float32Array([1, 0, 0, 0]),
      );
      this.fallback = this.resources.textures.create({
        label: "Empty bloom",
        size: [1, 1],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.gpu.queue.writeTexture(
        { texture: this.fallback },
        new Uint16Array(4),
        { bytesPerRow: 8 },
        [1, 1],
      );
    }
    if (this.strength > 0 && !this.bloomReduction) {
      this.bloomReduction = createPostReduction(
        this.gpu,
        this.resources,
        "rgba16float",
        false,
      );
      changed = true;
    }
    if (this.automatic && !this.lumaReduction) {
      this.lumaReduction = createPostReduction(
        this.gpu,
        this.resources,
        "rgba32float",
        true,
      );
      changed = true;
      const adaptation = createExposureAdaptation(device, this.resources);
      this.adaptLayout = adaptation.layout;
      this.adaptPipeline = adaptation.pipeline;
    }
    if (
      !changed &&
      width === this.width &&
      height === this.height &&
      source === this.source
    )
      return;
    this.revision++;
    this.width = width;
    this.height = height;
    this.source = source;
    if (this.bloom) this.resources.textures.destroy(this.bloom);
    for (const level of this.luminance)
      this.resources.textures.destroy(level.texture);
    this.bloomLevels.length = this.luminance.length = 0;
    /** Creates one retained compute binding group for the supplied reduction resources. */
    const group = (
      layout: GPUBindGroupLayout,
      input: GPUTextureView,
      target: GPUTextureView,
    ) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: input },
          { binding: 1, resource: target },
          { binding: 2, resource: { buffer: this.buffer! } },
        ],
      });
    if (this.bloomReduction) {
      const w = Math.max(1, Math.floor(width / 2)),
        h = Math.max(1, Math.floor(height / 2)),
        mips = Math.min(6, Math.floor(Math.log2(Math.max(w, h))) + 1);
      this.bloom = this.resources.textures.create({
        label: "Bloom pyramid",
        size: [w, h],
        mipLevelCount: mips,
        format: "rgba16float",
        usage:
          GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      let input = source;
      for (let mip = 0; mip < mips; mip++) {
        const view = this.bloom.createView({
          baseMipLevel: mip,
          mipLevelCount: 1,
        });
        this.bloomLevels.push({
          width: Math.max(1, w >> mip),
          height: Math.max(1, h >> mip),
          texture: this.bloom,
          view,
          group: group(this.bloomReduction.layout, input, view),
        });
        input = view;
      }
    }
    if (this.lumaReduction) {
      let w = width,
        h = height,
        input = source;
      do {
        w = Math.max(1, Math.ceil(w / 2));
        h = Math.max(1, Math.ceil(h / 2));
        const texture = this.resources.textures.create({
            label: "Weighted log luminance",
            size: [w, h],
            format: "rgba32float",
            usage:
              GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
          }),
          view = texture.createView();
        this.luminance.push({
          width: w,
          height: h,
          texture,
          view,
          group: group(this.lumaReduction.layout, input, view),
        });
        input = view;
      } while (w > 1 || h > 1);
      this.adaptGroup = device.createBindGroup({
        layout: this.adaptLayout!,
        entries: [
          { binding: 0, resource: input },
          { binding: 1, resource: { buffer: this.exposure! } },
          { binding: 2, resource: { buffer: this.buffer! } },
        ],
      });
    }
  }
  /** Dispatches each retained reduction level in order without creating new targets. */
  private encodeLevels(
    encoder: GPUCommandEncoder,
    reduction: PostReduction,
    levels: readonly Level[],
    label: string,
  ): void {
    const pass = encoder.beginComputePass({ label });
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i]!;
      pass.setPipeline(i === 0 ? reduction.first : reduction.reduce);
      pass.setBindGroup(0, level.group);
      pass.dispatchWorkgroups(
        Math.ceil(level.width / 8),
        Math.ceil(level.height / 8),
      );
    }
    pass.end();
  }
  /** Uploads changed controls, reduces bloom/log luminance and adapts persistent GPU exposure without CPU readback. */
  encode(encoder: GPUCommandEncoder): void {
    const values = this.nextSettings;
    values[0] = this.threshold;
    values[1] = this.strength;
    values[2] = Number(this.automatic);
    values[3] = this.deltaSeconds;
    values[4] = this.key;
    values[5] = this.speed;
    values[6] = this.minStops;
    values[7] = this.maxStops;
    let changed = false;
    for (let i = 0; i < 8; i++)
      if (values[i] !== this.settings[i]) changed = true;
    if (changed) {
      this.settings.set(values);
      this.gpu.queue.writeBuffer(this.buffer!, 0, this.settings);
    }
    if (this.strength > 0)
      this.encodeLevels(
        encoder,
        this.bloomReduction!,
        this.bloomLevels,
        "Bloom pyramid",
      );
    if (this.automatic) {
      this.encodeLevels(
        encoder,
        this.lumaReduction!,
        this.luminance,
        "Log luminance pyramid",
      );
      const pass = encoder.beginComputePass({ label: "Exposure adaptation" });
      pass.setPipeline(this.adaptPipeline!);
      pass.setBindGroup(0, this.adaptGroup!);
      pass.dispatchWorkgroups(1);
      pass.end();
    }
  }
}
