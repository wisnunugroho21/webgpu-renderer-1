import { textureMemory, type TextureMemory } from "./TextureMemory";
import { ResourceStats } from "./ResourceStats";
export class TextureManager {
  private readonly owned = new Map<
    GPUTexture,
    TextureMemory & { renderTarget: boolean }
  >();
  /** Initializes tracked GPU texture ownership. */
  constructor(
    private readonly device: GPUDevice,
    private readonly stats: ResourceStats,
  ) {}
  /** Allocates and tracks a GPU texture for later explicit retirement. */
  create(
    descriptor: GPUTextureDescriptor,
    kind?: "asset" | "render-target",
  ): GPUTexture {
    const memory = textureMemory(descriptor);
    // WebGPU usage bits: RENDER_ATTACHMENT=0x10, STORAGE_BINDING=0x08, COPY_DST=0x02.
    const renderTarget = kind
      ? kind === "render-target"
      : !!(descriptor.usage & (0x10 | 0x08)) && !(descriptor.usage & 0x02);
    const texture = this.device.createTexture(descriptor);
    this.owned.set(texture, { ...memory, renderTarget });
    this.stats.textureBytes += memory.bytes;
    this.stats.textureMipBytes += memory.mipBytes;
    this.stats.compressedTextureBytes += memory.compressedBytes;
    if (renderTarget) this.stats.renderTargetBytes += memory.bytes;
    this.stats.textureCreations++;
    this.stats.textures++;
    return texture;
  }
  /** Destroys one tracked texture and updates live-resource accounting. */
  destroy(texture: GPUTexture): void {
    const memory = this.owned.get(texture);
    if (memory && this.owned.delete(texture)) {
      this.stats.textureBytes -= memory.bytes;
      this.stats.textureMipBytes -= memory.mipBytes;
      this.stats.compressedTextureBytes -= memory.compressedBytes;
      if (memory.renderTarget) this.stats.renderTargetBytes -= memory.bytes;
      this.stats.textures--;
      texture.destroy();
    }
  }
  /** Destroys all remaining owned textures. */
  dispose(): void {
    for (const texture of this.owned.keys()) this.destroy(texture);
  }
}
