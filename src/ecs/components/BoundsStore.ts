import { ComponentStore } from "./ComponentStore";
export class BoundsStore extends ComponentStore {
  readonly centerX: Float32Array;
  readonly centerY: Float32Array;
  readonly centerZ: Float32Array;
  readonly radius: Float32Array;
  readonly min: Float32Array;
  readonly max: Float32Array;
  /** Initializes mesh-local AABB and sphere component storage. */
  constructor(capacity: number) {
    super(capacity);
    this.centerX = new Float32Array(capacity);
    this.centerY = new Float32Array(capacity);
    this.centerZ = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.min = new Float32Array(capacity * 3);
    this.max = new Float32Array(capacity * 3);
  }
  /** Stores a mesh-local conservative sphere and its enclosing local box, marking bounds membership. */
  setSphere(
    entity: number,
    x: number,
    y: number,
    z: number,
    radius: number,
  ): void {
    if (radius < 0) throw new Error("Negative radius");
    this.add(entity);
    this.centerX[entity] = x;
    this.centerY[entity] = y;
    this.centerZ[entity] = z;
    this.radius[entity] = radius;
    for (let i = 0; i < 3; i++) {
      const c = i === 0 ? x : i === 1 ? y : z;
      this.min[entity * 3 + i] = c - radius;
      this.max[entity * 3 + i] = c + radius;
    }
  }
  /** Stores mesh-local box extrema and derives its enclosing sphere. */
  setAABB(
    entity: number,
    min: ArrayLike<number>,
    max: ArrayLike<number>,
  ): void {
    this.add(entity);
    let radiusSquared = 0;
    for (let axis = 0; axis < 3; axis++) {
      if (
        !Number.isFinite(min[axis]) ||
        !Number.isFinite(max[axis]) ||
        min[axis]! > max[axis]!
      )
        throw new Error("Invalid AABB");
      this.min[entity * 3 + axis] = min[axis]!;
      this.max[entity * 3 + axis] = max[axis]!;
      radiusSquared += ((max[axis]! - min[axis]!) / 2) ** 2;
    }
    this.centerX[entity] = (min[0]! + max[0]!) / 2;
    this.centerY[entity] = (min[1]! + max[1]!) / 2;
    this.centerZ[entity] = (min[2]! + max[2]!) / 2;
    this.radius[entity] = Math.sqrt(radiusSquared);
  }
}
