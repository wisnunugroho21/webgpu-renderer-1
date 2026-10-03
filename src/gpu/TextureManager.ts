import { ResourceStats } from "./ResourceStats";
export class TextureManager {
  private readonly owned = new Set<GPUTexture>();
  constructor(
    private readonly device: GPUDevice,
    private readonly stats: ResourceStats,
  ) {}
  create(descriptor: GPUTextureDescriptor): GPUTexture {
    const texture = this.device.createTexture(descriptor);
    this.owned.add(texture);
    this.stats.textureCreations++;
    this.stats.textures++;
    return texture;
  }
  destroy(texture: GPUTexture): void {
    if (this.owned.delete(texture)) {
      this.stats.textures--;
      texture.destroy();
    }
  }
  dispose(): void {
    for (const texture of this.owned) this.destroy(texture);
  }
}
