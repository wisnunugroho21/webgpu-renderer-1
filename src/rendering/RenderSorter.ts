import { RenderQueue } from "./RenderQueue";
import { RenderWorld } from "./RenderWorld";
export class RenderSorter {
  private world!: RenderWorld;
  private queue!: RenderQueue;
  private readonly opaqueCompare = (a: number, b: number): number =>
    this.queue.pipeline[a]! - this.queue.pipeline[b]! ||
    this.world.materialId[a]! - this.world.materialId[b]! ||
    this.world.meshId[a]! - this.world.meshId[b]! ||
    Math.floor(this.queue.depth[a]! / 4) -
      Math.floor(this.queue.depth[b]! / 4) ||
    a - b;
  private readonly transparentCompare = (a: number, b: number): number =>
    this.queue.depth[b]! - this.queue.depth[a]! || a - b;
  private sortIfNeeded(
    indices: Uint32Array,
    count: number,
    compare: (a: number, b: number) => number,
  ): void {
    for (let i = 1; i < count; i++)
      if (compare(indices[i - 1]!, indices[i]!) > 0) {
        indices.subarray(0, count).sort(compare);
        return;
      }
  }
  sort(queue: RenderQueue, world: RenderWorld, sortOpaque = true): void {
    this.world = world;
    this.queue = queue;
    if (sortOpaque) {
      this.sortIfNeeded(queue.opaque, queue.opaqueCount, this.opaqueCompare);
      this.sortIfNeeded(queue.mask, queue.maskCount, this.opaqueCompare);
    }
    this.sortIfNeeded(
      queue.transparent,
      queue.transparentCount,
      this.transparentCompare,
    );
    queue.order.set(queue.opaque.subarray(0, queue.opaqueCount), 0);
    queue.order.set(queue.mask.subarray(0, queue.maskCount), queue.opaqueCount);
    queue.order.set(
      queue.transparent.subarray(0, queue.transparentCount),
      queue.opaqueCount + queue.maskCount,
    );
  }
}
