import { LIGHT_BYTES } from "./layouts";
import { BufferManager } from "../gpu/BufferManager";
import { RenderWorld } from "./RenderWorld";
// Capture the shared ABI stride once so upload loops use an immutable local binding.
const lightBytes = LIGHT_BYTES;

/** Persistent 64-byte light records; upload only adjacent dirty ranges. */
export class LightBuffer {
  readonly buffer: GPUBuffer;
  uploadBytes = 0;
  constructor(manager: BufferManager, capacity: number) {
    this.buffer = manager.create({
      label: "Shared lights",
      size: Math.max(LIGHT_BYTES, capacity * LIGHT_BYTES),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
  upload(queue: GPUQueue, world: RenderWorld): void {
    this.uploadBytes = 0;
    // The extra sentinel iteration flushes a dirty run ending at the last record.
    let start = -1;
    for (let i = 0; i <= world.lightCount; i++) {
      if (i < world.lightCount && world.lightDirty[i]) {
        if (start === -1) start = i;
        continue;
      }
      if (start === -1) continue;
      queue.writeBuffer(
        this.buffer,
        start * lightBytes,
        world.lightData.buffer,
        start * lightBytes,
        (i - start) * lightBytes,
      );
      world.lightDirty.fill(0, start, i);
      this.uploadBytes += (i - start) * lightBytes;
      start = -1;
    }
  }
}
