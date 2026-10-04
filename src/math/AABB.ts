import { Vec3 } from "./Vec3";
export class AABB {
  /** Initializes axis-aligned minimum and maximum coordinates. */
  constructor(
    readonly min = Vec3.create(Infinity, Infinity, Infinity),
    readonly max = Vec3.create(-Infinity, -Infinity, -Infinity),
  ) {}
  /** Extends minimum/maximum coordinates to include the supplied point. */
  expand(point: ArrayLike<number>): void {
    for (let i = 0; i < 3; i++) {
      this.min[i] = Math.min(this.min[i]!, point[i]!);
      this.max[i] = Math.max(this.max[i]!, point[i]!);
    }
  }
  /** Tests inclusive axis overlap against another box. */
  intersects(other: AABB): boolean {
    for (let i = 0; i < 3; i++)
      if (this.max[i]! < other.min[i]! || this.min[i]! > other.max[i]!)
        return false;
    return true;
  }
}
