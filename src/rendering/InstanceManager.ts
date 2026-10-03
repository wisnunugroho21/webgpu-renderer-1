import { RenderQueue } from "./RenderQueue";
import { RenderWorld } from "./RenderWorld";
export class InstanceManager {
  readonly data: Uint32Array;
  constructor(capacity: number) {
    this.data = new Uint32Array(capacity * 8);
  }
  update(queue: RenderQueue, world: RenderWorld): void {
    for (let i = 0; i < queue.count; i++) {
      const object = queue.order[i]!,
        offset = i * 8;
      this.data[offset] = world.transformIndex[object]!;
      this.data[offset + 1] = world.materialId[object]!;
      // Joint and morph ranges are populated when their runtime phases exist.
      this.data[offset + 2] =
        this.data[offset + 3] =
        this.data[offset + 4] =
        this.data[offset + 5] =
          0;
      this.data[offset + 6] = world.entityId[object]!;
      this.data[offset + 7] = world.flags[object]!;
    }
  }
}
