import { ResourceStats } from "./ResourceStats";
export class BufferManager {
  private readonly owned = new Set<GPUBuffer>();
  /** Initializes tracked GPU buffer ownership. */
  constructor(
    private readonly device: GPUDevice,
    private readonly stats: ResourceStats,
  ) {}
  /** Allocates and tracks a GPU buffer, updating live-byte and creation counters. */
  create(descriptor: GPUBufferDescriptor): GPUBuffer {
    const buffer = this.device.createBuffer(descriptor);
    this.owned.add(buffer);
    this.stats.bufferCreations++;
    this.stats.buffers++;
    this.stats.bufferBytes += buffer.size;
    return buffer;
  }
  /** Destroys a tracked buffer once and removes its live-byte accounting. */
  destroy(buffer: GPUBuffer): void {
    if (!this.owned.delete(buffer)) return;
    this.stats.buffers--;
    this.stats.bufferBytes -= buffer.size;
    buffer.destroy();
  }
  /** Destroys every remaining owned GPU buffer and clears tracking. */
  dispose(): void {
    for (const buffer of this.owned) this.destroy(buffer);
  }
}
