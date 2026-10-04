import { BufferManager } from "../gpu/BufferManager";
import { RenderWorld } from "./RenderWorld";
/** Shared scalar weights; coalesce adjacent dirty values instead of rewriting every object. */
export class MorphWeightBuffer {
  readonly buffer: GPUBuffer;
  uploadBytes = 0;
  writes = 0;
  updatedWeights = 0;
  /** Initializes shared GPU morph weights and dirty-range uploads. */
  constructor(manager: BufferManager, capacity: number) {
    this.buffer = manager.create({
      label: "Shared morph weights",
      size: Math.max(4, capacity * 4),
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
  }
  /** Uploads dirty per-instance morph-weight ranges into shared storage. */
  upload(queue: GPUQueue, world: RenderWorld): void {
    this.uploadBytes = this.writes = this.updatedWeights = 0;
    // Visit one past the last weight to flush the final dirty run.
    let start = -1;
    for (let w = 0; w <= world.morphWeightCount; w++) {
      if (w < world.morphWeightCount && world.morphDirty[w]) {
        if (start === -1) start = w;
        continue;
      }
      if (start === -1) continue;
      queue.writeBuffer(
        this.buffer,
        start * 4,
        world.morphWeights.buffer,
        start * 4,
        (w - start) * 4,
      );
      world.morphDirty.fill(0, start, w);
      this.uploadBytes += (w - start) * 4;
      this.updatedWeights += w - start;
      this.writes++;
      start = -1;
    }
  }
}
