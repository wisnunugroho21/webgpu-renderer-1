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
  readonly shaders: ShaderManager;
  readonly samplers: SamplerCache;
  readonly pipelines: PipelineCache;
  constructor(device: GPUDevice) {
    this.buffers = new BufferManager(device, this.stats);
    this.textures = new TextureManager(device, this.stats);
    this.shaders = new ShaderManager(device, this.stats);
    this.samplers = new SamplerCache(device, this.stats);
    this.pipelines = new PipelineCache(device, this.stats);
  }
  dispose(): void {
    this.buffers.dispose();
    this.textures.dispose();
    this.shaders.clear();
    this.samplers.clear();
    this.pipelines.clear();
  }
}
