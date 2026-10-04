import { Vec3 } from "./Vec3";
export class BoundingSphere {
  /** Initializes a center and conservative radius; invalid input is rejected. */
  constructor(
    readonly center = Vec3.create(),
    public radius = 0,
  ) {
    if (radius < 0) throw new Error("Negative sphere radius");
  }
  /** Tests whether center distance is within the sum of the two radii. */
  intersects(other: BoundingSphere): boolean {
    const dx = this.center[0]! - other.center[0]!,
      dy = this.center[1]! - other.center[1]!,
      dz = this.center[2]! - other.center[2]!;
    return dx * dx + dy * dy + dz * dz <= (this.radius + other.radius) ** 2;
  }
}
