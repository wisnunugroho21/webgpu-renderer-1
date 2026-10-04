import { ResourceStats } from "./ResourceStats";
export class TextureManager {
  private readonly owned = new Set<GPUTexture>();
  /** Initializes tracked GPU texture ownership. */
  constructor(
    private readonly device: GPUDevice,
    private readonly stats: ResourceStats,
  ) {}
  /** Allocates and tracks a GPU texture for later explicit retirement. */
  create(descriptor: GPUTextureDescriptor): GPUTexture {
    const texture = this.device.createTexture(descriptor);
    this.owned.add(texture);
    this.stats.textureCreations++;
    this.stats.textures++;
    return texture;
  }
  /** Destroys one tracked texture and updates live-resource accounting. */
  destroy(texture: GPUTexture): void {
    if (this.owned.delete(texture)) {
      this.stats.textures--;
      texture.destroy();
    }
  }
  /** Destroys all remaining owned textures. */
  dispose(): void {
    for (const texture of this.owned) this.destroy(texture);
  }
}
