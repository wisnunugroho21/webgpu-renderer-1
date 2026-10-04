import { Frustum } from "../math/Frustum";
import { RenderWorld } from "../rendering/RenderWorld";
export class FrustumCuller {
  readonly visible: Uint32Array;
  totalRenderables = 0;
  frustumTested = 0;
  frustumRejected = 0;
  visibleObjects = 0;
  /** Initializes allocation-free linear sphere-frustum culling. */
  constructor(capacity: number) {
    this.visible = new Uint32Array(capacity);
  }
  /** Tests compact render-object spheres and writes surviving indices into reusable storage. */
  cull(
    world: RenderWorld,
    frustum: Frustum,
    mode: "sphere" | "aabb" = "aabb",
  ): number {
    if (world.count > this.visible.length)
      throw new Error("Visibility capacity exceeded");
    this.totalRenderables = this.frustumTested = world.count;
    this.frustumRejected = this.visibleObjects = 0;
    for (let object = 0; object < world.count; object++) {
      if (this.intersects(world, object, frustum, mode))
        this.visible[this.visibleObjects++] = object;
      else this.frustumRejected++;
    }
    return this.visibleObjects;
  }
  /** Evaluates one conservative sphere against the prepared clipping planes. */
  intersects(
    world: RenderWorld,
    object: number,
    frustum: Frustum,
    mode: "sphere" | "aabb" = "aabb",
  ): boolean {
    const planes = frustum.planes;
    for (let p = 0; p < 24; p += 4) {
      let distance = planes[p + 3]!;
      if (mode === "sphere") {
        for (let axis = 0; axis < 3; axis++)
          distance += planes[p + axis]! * world.sphere[object * 4 + axis]!;
        distance += world.sphere[object * 4 + 3]!;
      } else {
        for (let axis = 0; axis < 3; axis++)
          distance +=
            planes[p + axis]! *
            (planes[p + axis]! >= 0
              ? world.boundsMax[object * 3 + axis]!
              : world.boundsMin[object * 3 + axis]!);
      }
      // Tiny numerical uncertainty stays visible.
      if (distance < -1e-5) return false;
    }
    return true;
  }
}
