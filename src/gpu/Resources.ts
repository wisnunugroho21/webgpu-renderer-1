import { TransientTargetPool } from "./TransientTargetPool";
import { BufferManager } from "./BufferManager";
import { TextureManager } from "./TextureManager";
import { ShaderManager } from "./ShaderManager";
import { SamplerCache } from "./SamplerCache";
import { PipelineCache } from "./PipelineCache";
import { ResourceStats } from "./ResourceStats";
export class Resources {
  readonly stats = new ResourceStats();
  readonly buffers: BufferManager;
  readonly textures: TextureManager;
  readonly targets: TransientTargetPool;
  readonly shaders: ShaderManager;
  readonly samplers: SamplerCache;
  readonly pipelines: PipelineCache;
  /** Initializes shared GPU resource managers and creation counters. */
  constructor(device: GPUDevice) {
    this.buffers = new BufferManager(device, this.stats);
    this.textures = new TextureManager(device, this.stats);
    this.targets = new TransientTargetPool(this.textures, () => {
      // Only released targets at cold lifecycle boundaries request a completion fence.
      return device.queue.onSubmittedWorkDone();
    });
    this.shaders = new ShaderManager(device, this.stats);
    this.samplers = new SamplerCache(device, this.stats);
    this.pipelines = new PipelineCache(device, this.stats);
  }
  /** Releases tracked buffers/textures and clears pipeline, shader and sampler caches. */
  dispose(): void {
    this.buffers.dispose();
    this.targets.dispose();
    this.textures.dispose();
    this.shaders.clear();
    this.samplers.clear();
    this.pipelines.clear();
  }
}
