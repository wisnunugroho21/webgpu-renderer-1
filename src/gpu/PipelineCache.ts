import { CacheKey } from "./CacheKey";
import { ResourceStats } from "./ResourceStats";
export class PipelineCache {
  private readonly keys = new CacheKey();
  private readonly computeCache = new Map<string, GPUComputePipeline>();
  private readonly cache = new Map<string, GPURenderPipeline>();
  constructor(
    private readonly device: GPUDevice,
    private readonly stats: ResourceStats,
  ) {}
  get(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    // Key includes shader identity/entry points, vertex layouts, topology, culling,
    // depth/stencil, blend targets/formats, explicit layouts and sample count.
    const key = this.keys.encode({
      ...descriptor,
      primitive: {
        topology: "triangle-list",
        frontFace: "ccw",
        cullMode: "none",
        ...descriptor.primitive,
      },
      multisample: {
        count: 1,
        mask: 0xffffffff,
        alphaToCoverageEnabled: false,
        ...descriptor.multisample,
      },
    });
    const existing = this.cache.get(key);
    if (existing) {
      this.stats.cacheHits++;
      return existing;
    }
    this.stats.cacheMisses++;
    this.stats.pipelineCreations++;
    const pipeline = this.device.createRenderPipeline(descriptor);
    this.cache.set(key, pipeline);
    return pipeline;
  }
  getCompute(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline {
    const key = this.keys.encode(descriptor),
      existing = this.computeCache.get(key);
    if (existing) {
      this.stats.cacheHits++;
      return existing;
    }
    this.stats.cacheMisses++;
    this.stats.pipelineCreations++;
    const pipeline = this.device.createComputePipeline(descriptor);
    this.computeCache.set(key, pipeline);
    return pipeline;
  }
  clear(): void {
    this.cache.clear();
    this.computeCache.clear();
  }
}
