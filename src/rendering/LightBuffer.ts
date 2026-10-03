import { BufferManager } from "../gpu/BufferManager";
import { RenderWorld } from "./RenderWorld";
export class LightBuffer {
  readonly buffer: GPUBuffer;
  uploadBytes = 0;
  constructor(manager: BufferManager, capacity: number) {
    this.buffer = manager.create({
      label: "Shared lights",
      size: Math.max(64, capacity * 64),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
  upload(queue: GPUQueue, world: RenderWorld): void {
    this.uploadBytes = 0;
    let start = -1;
    for (let i = 0; i <= world.lightCount; i++) {
      if (i < world.lightCount && world.lightDirty[i]) {
        if (start === -1) start = i;
        continue;
      }
      if (start === -1) continue;
      queue.writeBuffer(
        this.buffer,
        start * 64,
        world.lightData.buffer,
        start * 64,
        (i - start) * 64,
      );
      world.lightDirty.fill(0, start, i);
      this.uploadBytes += (i - start) * 64;
      start = -1;
    }
  }
}
