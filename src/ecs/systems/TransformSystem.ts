import { TransformStore } from "../components/TransformStore";
import { Mat4 } from "../../math/Mat4";
/** Resolve dirty ancestors before descendants using fixed scratch storage. */
export class TransformSystem {
  updated = 0;
  private readonly local = Mat4.create();
  private readonly position = new Float32Array(3);
  private readonly rotation = new Float32Array(4);
  private readonly scale = new Float32Array(3);
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
        this.position[0] = store.positionX[e]!;
        this.position[1] = store.positionY[e]!;
        this.position[2] = store.positionZ[e]!;
        this.rotation[0] = store.rotationX[e]!;
        this.rotation[1] = store.rotationY[e]!;
        this.rotation[2] = store.rotationZ[e]!;
        this.rotation[3] = store.rotationW[e]!;
        this.scale[0] = store.scaleX[e]!;
        this.scale[1] = store.scaleY[e]!;
        this.scale[2] = store.scaleZ[e]!;
        Mat4.fromTRS(this.local, this.position, this.rotation, this.scale);
        const out = store.worldMatrices.subarray(e * 16, e * 16 + 16),
          parent = store.parent[e]!;
        if (parent === -1) out.set(this.local);
        else
          Mat4.multiply(
            out,
            store.worldMatrices.subarray(parent * 16, parent * 16 + 16),
            this.local,
          );
        store.dirty[e] = 0;
        this.updated++;
      }
    }
    store.dirtyCount = 0;
    return this.updated;
  }
}
