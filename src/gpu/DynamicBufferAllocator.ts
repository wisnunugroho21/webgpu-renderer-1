import { BufferManager } from "./BufferManager";
/** Triple-buffered shared arena. Queue writes/submissions stay ordered; no mapping or GPU waits. */
export class DynamicBufferAllocator {
  readonly buffers: readonly GPUBuffer[];
  readonly staging: Uint8Array;
  private cursor = 0;
  private slot = 0;
  uploadBytes = 0;
  constructor(
    manager: BufferManager,
    readonly capacity: number,
    readonly alignment: number,
    usage: GPUBufferUsageFlags,
  ) {
    if (
      !Number.isInteger(capacity) ||
      capacity <= 0 ||
      capacity % 4 !== 0 ||
      !Number.isInteger(alignment) ||
      alignment < 4 ||
      alignment % 4 !== 0
    )
      throw new Error("Invalid arena capacity/alignment");
    this.staging = new Uint8Array(capacity);
    this.buffers = Array.from({ length: 3 }, (_, i) =>
      manager.create({
        label: `Dynamic arena ${i}`,
        size: capacity,
        usage: usage | GPUBufferUsage.COPY_DST,
      }),
    );
  }
  get buffer(): GPUBuffer {
    return this.buffers[this.slot]!;
  }
  get frameSlot(): number {
    return this.slot;
  }
  get usedBytes(): number {
    return this.cursor;
  }
  beginFrame(frame: number): void {
    if (!Number.isSafeInteger(frame) || frame < 0)
      throw new Error("Invalid frame index");
    this.slot = frame % 3;
    this.cursor = 0;
    this.uploadBytes = 0;
  }
  allocate(bytes: number, alignment = this.alignment): number {
    if (
      !Number.isInteger(bytes) ||
      bytes <= 0 ||
      bytes % 4 !== 0 ||
      !Number.isInteger(alignment) ||
      alignment < 4 ||
      alignment % 4 !== 0
    )
      throw new Error("Invalid allocation");
    const offset = Math.ceil(this.cursor / alignment) * alignment;
    if (offset + bytes > this.capacity)
      throw new Error(
        `Dynamic arena capacity exceeded: ${offset + bytes} > ${this.capacity}`,
      );
    this.cursor = offset + bytes;
    return offset;
  }
  write(offset: number, data: ArrayBufferView): void {
    if (
      offset < 0 ||
      offset % 4 !== 0 ||
      offset + data.byteLength > this.cursor ||
      data.byteLength % 4 !== 0
    )
      throw new Error("Invalid arena write");
    this.staging.set(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      offset,
    );
  }
  flush(queue: GPUQueue): void {
    if (!this.cursor) return;
    queue.writeBuffer(this.buffer, 0, this.staging.buffer, 0, this.cursor);
    this.uploadBytes = this.cursor;
  }
}
