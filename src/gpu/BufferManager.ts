import { ResourceStats } from "./ResourceStats";
export class BufferManager {
  private readonly owned = new Set<GPUBuffer>();
  constructor(
    private readonly device: GPUDevice,
    private readonly stats: ResourceStats,
  ) {}
  create(descriptor: GPUBufferDescriptor): GPUBuffer {
    const buffer = this.device.createBuffer(descriptor);
    this.owned.add(buffer);
    this.stats.bufferCreations++;
    this.stats.buffers++;
    this.stats.bufferBytes += buffer.size;
    return buffer;
  }
  destroy(buffer: GPUBuffer): void {
    if (!this.owned.delete(buffer)) return;
    this.stats.buffers--;
    this.stats.bufferBytes -= buffer.size;
    buffer.destroy();
  }
  dispose(): void {
    for (const buffer of this.owned) this.destroy(buffer);
  }
}
