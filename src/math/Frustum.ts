import { AABB } from "./AABB";
import { BoundingSphere } from "./BoundingSphere";
export class Frustum {
  readonly planes = new Float32Array(24);
  /** WebGPU clip inequalities: -w<=x,y<=w and 0<=z<=w. */
  setFromMatrix(m: ArrayLike<number>): void {
    for (let plane = 0; plane < 6; plane++) {
      const axis = plane < 2 ? 0 : plane < 4 ? 1 : 2;
      const sign = plane % 2 === 0 ? 1 : -1;
      for (let c = 0; c < 4; c++)
        this.planes[plane * 4 + c] =
          plane === 4 ? m[c * 4 + 2]! : m[c * 4 + 3]! + sign * m[c * 4 + axis]!;
      const length = Math.hypot(
        this.planes[plane * 4]!,
        this.planes[plane * 4 + 1]!,
        this.planes[plane * 4 + 2]!,
      );
      for (let c = 0; c < 4; c++) this.planes[plane * 4 + c]! /= length;
    }
  }
  intersectsSphere(sphere: BoundingSphere): boolean {
    for (let p = 0; p < 24; p += 4)
      if (
        this.planes[p]! * sphere.center[0]! +
          this.planes[p + 1]! * sphere.center[1]! +
          this.planes[p + 2]! * sphere.center[2]! +
          this.planes[p + 3]! <
        -sphere.radius
      )
        return false;
    return true;
  }
  intersectsAABB(box: AABB): boolean {
    for (let p = 0; p < 24; p += 4) {
      let distance = this.planes[p + 3]!;
      for (let axis = 0; axis < 3; axis++)
        distance +=
          this.planes[p + axis]! *
          (this.planes[p + axis]! >= 0 ? box.max[axis]! : box.min[axis]!);
      if (distance < 0) return false;
    }
    return true;
  }
}
