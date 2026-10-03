import { MATRIX_BYTES } from "./layouts";
import { BufferManager } from "../gpu/BufferManager";
import { RenderWorld } from "./RenderWorld";
// Capture the shared ABI stride once so upload loops use an immutable local binding.
const matrixBytes = MATRIX_BYTES;

/** One persistent GPU palette for all characters; changed adjacent joints share writes. */
export class JointMatrixBuffer {
  readonly buffer: GPUBuffer;
  uploadBytes = 0;
  updatedJoints = 0;
  writes = 0;
  constructor(manager: BufferManager, capacity: number) {
    this.buffer = manager.create({
      label: "Shared joint matrices",
      size: Math.max(MATRIX_BYTES, capacity * MATRIX_BYTES),
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
  }
  upload(queue: GPUQueue, world: RenderWorld): void {
    this.uploadBytes = this.updatedJoints = this.writes = 0;
    // The extra sentinel iteration flushes a dirty run ending at the last record.
    let start = -1;
    for (let j = 0; j <= world.jointCount; j++) {
      if (j < world.jointCount && world.jointDirty[j]) {
        if (start === -1) start = j;
        continue;
      }
      if (start === -1) continue;
      const size = (j - start) * matrixBytes;
      queue.writeBuffer(
        this.buffer,
        start * matrixBytes,
        world.jointMatrices.buffer,
        start * matrixBytes,
        size,
      );
      world.jointDirty.fill(0, start, j);
      this.uploadBytes += size;
      this.updatedJoints += j - start;
      this.writes++;
      start = -1;
    }
  }
}
