import type { Resources } from "../../gpu/Resources";
import type { TargetLease } from "../../gpu/TransientTargetPool";
import type { MipGenerator, MipChain } from "../materials/MipGenerator";
import type { HDRRendering } from "./HDRRendering";
export interface TransmissionInputs {
  background: GPUTextureView;
  sampler: GPUSampler;
}
/** Optional opaque-radiance capture; all roughness mip passes and material bindings are prepared cold. */
export class TransmissionRendering {
  private active = false;
  private target?: TargetLease;
  private source?: GPUTexture;
  private chain?: MipChain;
  inputs?: TransmissionInputs;
  mipPasses = 0;
  /** Retain shared linear storage, downsampler and a callback for bounded color-family setup. */
  constructor(
    private readonly resources: Resources,
    private readonly hdr: HDRRendering,
    private readonly mipmaps: MipGenerator,
    private readonly changed: () => void,
  ) {}
  /** Expose retained capture storage for GPU consumers or explicit diagnostic readback. */
  get backgroundTexture(): GPUTexture | undefined {
    return this.target?.texture;
  }
  /** Report whether opaque capture and transmission shading are selected. */
  get enabled(): boolean {
    return this.active;
  }
  /** Prepare shared linear radiance and bounded variants only on explicit configuration changes. */
  set enabled(value: boolean) {
    if (value === this.active) return;
    this.active = value;
    this.hdr.transmissionEnabled = value;
    if (value) this.resize(this.hdr.sceneTexture);
  }
  /** Recreate one mipmapped capture at size changes and refresh retained material-family groups. */
  resize(source: GPUTexture | undefined): void {
    if (!this.active || !source || source === this.source) return;
    this.target?.release();
    this.source = source;
    this.target = this.resources.targets.acquire({
      label: "Opaque transmission background",
      size: [source.width, source.height],
      format: "rgba16float",
      mipLevelCount:
        1 + Math.floor(Math.log2(Math.max(source.width, source.height))),
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.inputs = {
      background: this.target.view,
      sampler: this.resources.samplers.get({
        minFilter: "linear",
        magFilter: "linear",
        mipmapFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      }),
    };
    this.chain = this.mipmaps.prepare(this.target.texture);
    this.changed();
  }
  /** Copy opaque radiance before all transparent streams, then downsample using immutable mip bindings. */
  encode(encoder: GPUCommandEncoder, needed = true): void {
    this.mipPasses = 0;
    if (!this.active || !needed || !this.target || !this.source) return;
    encoder.copyTextureToTexture(
      { texture: this.source },
      { texture: this.target.texture },
      [this.source.width, this.source.height],
    );
    this.chain!.encode(encoder);
    this.mipPasses = this.target.texture.mipLevelCount - 1;
  }
  /** Retire the capture lease on renderer disposal; ordinary frames never fence or release it. */
  dispose(): void {
    this.target?.release();
    this.target = undefined;
  }
}
