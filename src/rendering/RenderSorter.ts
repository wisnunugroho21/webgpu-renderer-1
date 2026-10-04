import { RenderQueue } from "./RenderQueue";
import { RenderWorld } from "./RenderWorld";
export class RenderSorter {
  lodAware = false;
  private world!: RenderWorld;
  private queue!: RenderQueue;
  /** Orders opaque/masked objects by pipeline, material, mesh, optional LOD group and coarse front-to-back depth. */
  private readonly opaqueCompare = (a: number, b: number): number =>
    this.queue.pipeline[a]! - this.queue.pipeline[b]! ||
    this.world.materialId[a]! - this.world.materialId[b]! ||
    this.world.meshId[a]! - this.world.meshId[b]! ||
    (this.lodAware ? this.world.lodGroup[a]! - this.world.lodGroup[b]! : 0) ||
    Math.floor(this.queue.depth[a]! / 4) -
      Math.floor(this.queue.depth[b]! / 4) ||
    a - b;
  /** Orders blended objects from farthest to nearest with deterministic index ties. */
  private readonly transparentCompare = (a: number, b: number): number =>
    this.queue.depth[b]! - this.queue.depth[a]! || a - b;
  /** Checks existing order first and only sorts the used index range when it is out of order. */
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
  /** Sorts opaque/masked state runs and transparency, then concatenates the three queues into draw order. */
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
