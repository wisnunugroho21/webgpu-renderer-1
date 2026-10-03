import { CacheKey } from "./CacheKey";
import { ResourceStats } from "./ResourceStats";
export class SamplerCache {
  private readonly keys = new CacheKey();
  private readonly cache = new Map<string, GPUSampler>();
  constructor(
    private readonly device: GPUDevice,
    private readonly stats: ResourceStats,
  ) {}
  get(descriptor: GPUSamplerDescriptor = {}): GPUSampler {
    const normalized = {
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
      magFilter: "nearest",
      minFilter: "nearest",
      mipmapFilter: "nearest",
      lodMinClamp: 0,
      lodMaxClamp: 32,
      maxAnisotropy: 1,
      ...descriptor,
    } as GPUSamplerDescriptor;
    const key = this.keys.encode(normalized),
      existing = this.cache.get(key);
    if (existing) {
      this.stats.cacheHits++;
      return existing;
    }
    this.stats.cacheMisses++;
    this.stats.samplerCreations++;
    const sampler = this.device.createSampler(normalized);
    this.cache.set(key, sampler);
    return sampler;
  }
  clear(): void {
    this.cache.clear();
  }
}
