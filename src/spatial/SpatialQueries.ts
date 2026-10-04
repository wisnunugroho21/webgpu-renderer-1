import { RenderWorld } from "../rendering/RenderWorld";
import { Ray } from "./Ray";
export class RayHit {
  objectIndex = -1;
  entityId = -1;
  generation = -1;
  distance = Infinity;
  readonly point = new Float32Array(3);
}
/** Snapshot broad-phase queries include culled renderables. AABB hits are not triangle hits or physics. */
export class SpatialQueries {
  /** Initializes broad-phase queries against the extracted render snapshot. */
  constructor(private readonly world: RenderWorld) {}
  /** Finds the nearest matching snapshot AABB hit and writes identity, distance and hit point into caller storage. */
  raycast(
    ray: Ray,
    out: RayHit,
    maxDistance = Infinity,
    requiredFlags = 0,
  ): boolean {
    if (maxDistance < 0 || Number.isNaN(maxDistance))
      throw new Error("Invalid ray distance");
    out.objectIndex = out.entityId = out.generation = -1;
    out.distance = Infinity;
    out.point.fill(0);
    let closest = maxDistance;
    for (let i = 0; i < this.world.count; i++) {
      if (
        requiredFlags &&
        (this.world.flags[i]! & requiredFlags) !== requiredFlags
      )
        continue;
      let near = 0,
        far = closest;
      for (let axis = 0; axis < 3; axis++) {
        const origin = ray.origin[axis]!,
          direction = ray.direction[axis]!;
        const min = this.world.boundsMin[i * 3 + axis]!,
          max = this.world.boundsMax[i * 3 + axis]!;
        if (direction === 0) {
          if (origin < min || origin > max) {
            far = -1;
            break;
          }
          continue;
        }
        const a = (min - origin) / direction,
          b = (max - origin) / direction;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
        if (near > far) break;
      }
      if (near > far || (out.objectIndex !== -1 && near >= closest)) continue;
      closest = near;
      out.objectIndex = i;
      out.entityId = this.world.entityId[i]!;
      out.generation = this.world.entityGeneration[i]!;
      out.distance = near;
    }
    if (out.objectIndex === -1) return false;
    for (let axis = 0; axis < 3; axis++)
      out.point[axis] = ray.origin[axis]! + ray.direction[axis]! * out.distance;
    return true;
  }
  /** Writes overlapping snapshot object indices into caller storage; bounds hits are broad-phase results, not physics contacts. */
  queryAABB(
    min: ArrayLike<number>,
    max: ArrayLike<number>,
    out: Uint32Array,
    requiredFlags = 0,
  ): number {
    for (let axis = 0; axis < 3; axis++)
      if (
        !Number.isFinite(min[axis]) ||
        !Number.isFinite(max[axis]) ||
        min[axis]! > max[axis]!
      )
        throw new Error("Invalid query bounds");
    let count = 0;
    for (let i = 0; i < this.world.count; i++) {
      if (
        requiredFlags &&
        (this.world.flags[i]! & requiredFlags) !== requiredFlags
      )
        continue;
      let overlaps = true;
      for (let axis = 0; axis < 3; axis++)
        if (
          this.world.boundsMax[i * 3 + axis]! < min[axis]! ||
          this.world.boundsMin[i * 3 + axis]! > max[axis]!
        ) {
          overlaps = false;
          break;
        }
      if (overlaps) {
        if (count === out.length)
          throw new Error("Spatial query output capacity exceeded");
        out[count++] = i;
      }
    }
    return count;
  }
}
