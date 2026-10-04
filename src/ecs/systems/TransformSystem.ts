import { TransformStore } from "../components/TransformStore";
import { Mat4 } from "../../math/Mat4";
/** Resolve dirty ancestors before descendants using fixed scratch storage. */
export class TransformSystem {
  updated = 0;
  private readonly local = Mat4.create();
  private readonly stack: Uint32Array;
  constructor(capacity: number) {
    this.stack = new Uint32Array(capacity);
  }
  update(store: TransformStore): number {
    this.updated = 0;
    for (let i = 0; i < store.dirtyCount; i++) {
      let entity = store.dirtyQueue[i]!,
        count = 0;
      store.queued[entity] = 0;
      if (!store.has[entity] || !store.dirty[entity]) continue;
      // Climb to the first clean ancestor, then pop in parent-to-child order.
      while (entity !== -1 && store.dirty[entity]) {
        this.stack[count++] = entity;
        entity = store.parent[entity]!;
      }
      while (count) {
        const e = this.stack[--count]!;
        const offset = e * 16,
          parent = store.parent[e]!;
        Mat4.fromTRSValues(
          parent === -1 ? store.worldMatrices : this.local,
          store.positionX[e]!,
          store.positionY[e]!,
          store.positionZ[e]!,
          store.rotationX[e]!,
          store.rotationY[e]!,
          store.rotationZ[e]!,
          store.rotationW[e]!,
          store.scaleX[e]!,
          store.scaleY[e]!,
          store.scaleZ[e]!,
          parent === -1 ? offset : 0,
        );
        if (parent !== -1) {
          // Reuse packed storage directly rather than creating two views per joint.
          Mat4.multiply(
            store.worldMatrices,
            store.worldMatrices,
            this.local,
            offset,
            parent * 16,
          );
        }
        store.dirty[e] = 0;
        this.updated++;
      }
    }
    store.dirtyCount = 0;
    return this.updated;
  }
}
