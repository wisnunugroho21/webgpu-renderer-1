import { BufferManager } from "../gpu/BufferManager";
import { RenderWorld } from "./RenderWorld";
/** One persistent GPU palette for all characters; changed adjacent joints share writes. */
export class JointMatrixBuffer {
  readonly buffer: GPUBuffer;
  uploadBytes = 0;
  updatedJoints = 0;
  writes = 0;
  constructor(manager: BufferManager, capacity: number) {
    this.buffer = manager.create({
      label: "Shared joint matrices",
      size: Math.max(64, capacity * 64),
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
  }
  upload(queue: GPUQueue, world: RenderWorld): void {
    this.uploadBytes = this.updatedJoints = this.writes = 0;
    let start = -1;
    for (let j = 0; j <= world.jointCount; j++) {
      if (j < world.jointCount && world.jointDirty[j]) {
        if (start === -1) start = j;
        continue;
      }
      if (start === -1) continue;
      const size = (j - start) * 64;
      queue.writeBuffer(
        this.buffer,
        start * 64,
        world.jointMatrices.buffer,
        start * 64,
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
