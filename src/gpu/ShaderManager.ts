import { ResourceStats } from "./ResourceStats";
export class ShaderManager {
  private readonly cache = new Map<string, GPUShaderModule>();
  constructor(
    private readonly device: GPUDevice,
    private readonly stats: ResourceStats,
  ) {}
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
  clear(): void {
    this.cache.clear();
  }
}
