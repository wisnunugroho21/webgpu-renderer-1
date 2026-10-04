import { ResourceStats } from "./ResourceStats";
export class ShaderManager {
  private readonly cache = new Map<string, GPUShaderModule>();
  /** Initializes source-keyed shader-module reuse. */
  constructor(
    private readonly device: GPUDevice,
    private readonly stats: ResourceStats,
  ) {}
  /** Returns a source-keyed shader module, creating and counting it only on a cache miss. */
  get(code: string, label?: string): GPUShaderModule {
    const existing = this.cache.get(code);
    if (existing) {
      this.stats.cacheHits++;
      return existing;
    }
    this.stats.cacheMisses++;
    this.stats.shaderModules++;
    const module = this.device.createShaderModule({ code, label });
    this.cache.set(code, module);
    return module;
  }
  /** Clears retained source-keyed shader-module reuse without publishing new frame work. */
  clear(): void {
    this.cache.clear();
  }
}
