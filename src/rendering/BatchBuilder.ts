import { RenderQueue } from "./RenderQueue";
import { RenderWorld } from "./RenderWorld";
export class BatchBuilder {
  count = 0;
  readonly firstInstance: Uint32Array;
  readonly instanceCount: Uint32Array;
  readonly pipeline: Uint8Array;
  readonly material: Uint32Array;
  readonly mesh: Uint32Array;
  constructor(capacity: number) {
    this.firstInstance = new Uint32Array(capacity);
    this.instanceCount = new Uint32Array(capacity);
    this.pipeline = new Uint8Array(capacity);
    this.material = new Uint32Array(capacity);
    this.mesh = new Uint32Array(capacity);
  }
  build(queue: RenderQueue, world: RenderWorld, instancing = true): void {
    this.count = 0;
    for (let i = 0; i < queue.count; i++) {
      const object = queue.order[i]!,
        pipeline = queue.pipeline[object]!,
        material = world.materialId[object]!,
        mesh = world.meshId[object]!,
        last = this.count - 1;
      if (
        instancing &&
        last >= 0 &&
        this.pipeline[last] === pipeline &&
        this.material[last] === material &&
        this.mesh[last] === mesh
      ) {
        this.instanceCount[last]!++;
        continue;
      }
      if (this.count === this.firstInstance.length)
        throw new Error("Batch capacity exceeded");
      const batch = this.count++;
      this.firstInstance[batch] = i;
      this.instanceCount[batch] = 1;
      this.pipeline[batch] = pipeline;
      this.material[batch] = material;
      this.mesh[batch] = mesh;
    }
  }
}
