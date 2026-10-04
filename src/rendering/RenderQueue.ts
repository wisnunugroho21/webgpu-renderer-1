import { RenderWorld } from "./RenderWorld";
import { MaterialManager } from "./materials/MaterialManager";
export class RenderQueue {
  readonly opaque: Uint32Array;
  readonly mask: Uint32Array;
  readonly transparent: Uint32Array;
  readonly order: Uint32Array;
  readonly depth: Float32Array;
  readonly pipeline: Uint8Array;
  opaqueCount = 0;
  maskCount = 0;
  transparentCount = 0;
  count = 0;
  /** Initializes persistent opaque, masked and transparent object ordering. */
  constructor(readonly capacity: number) {
    this.opaque = new Uint32Array(capacity);
    this.mask = new Uint32Array(capacity);
    this.transparent = new Uint32Array(capacity);
    this.order = new Uint32Array(capacity);
    this.depth = new Float32Array(capacity);
    this.pipeline = new Uint8Array(capacity);
  }
  /** Classifies candidate objects by alpha mode and records camera-space depth for sorting. */
  build(
    world: RenderWorld,
    materials: MaterialManager,
    view: ArrayLike<number>,
    visible?: Uint32Array,
    visibleCount = world.count,
  ): void {
    if (world.count > this.capacity) throw new Error("Queue capacity exceeded");
    this.opaqueCount = this.maskCount = this.transparentCount = 0;
    for (let n = 0; n < visibleCount; n++) {
      const i = visible ? visible[n]! : n,
        id = world.materialId[i]!;
      this.pipeline[i] = materials.pipelineIndex(id);
      this.depth[i] = -(
        view[2]! * world.sphere[i * 4]! +
        view[6]! * world.sphere[i * 4 + 1]! +
        view[10]! * world.sphere[i * 4 + 2]! +
        view[14]!
      );
      const mode = materials.alphaMode[id];
      if (mode === 0) this.opaque[this.opaqueCount++] = i;
      else if (mode === 1) this.mask[this.maskCount++] = i;
      else this.transparent[this.transparentCount++] = i;
    }
    this.count = this.opaqueCount + this.maskCount + this.transparentCount;
  }
}
