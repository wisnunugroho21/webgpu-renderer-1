import { Camera } from "../rendering/Camera";
import { Mat4 } from "../math/Mat4";
/** Caller-owned ray and unprojection scratch; screen coordinates use normalized canvas UV. */
export class Ray {
  readonly origin = new Float32Array(3);
  readonly direction = new Float32Array([0, 0, -1]);
  private readonly inverse = Mat4.create();
  private readonly near = new Float32Array(3);
  private readonly far = new Float32Array(3);
  /** Validates the ray origin/direction and stores a normalized direction for world-distance results. */
  set(origin: ArrayLike<number>, direction: ArrayLike<number>): void {
    if (origin.length < 3 || direction.length < 3)
      throw new Error("Invalid ray vectors");
    for (let i = 0; i < 3; i++)
      if (!Number.isFinite(origin[i]) || !Number.isFinite(direction[i]))
        throw new Error("Invalid ray vectors");
    const length = Math.hypot(direction[0]!, direction[1]!, direction[2]!);
    if (length === 0) throw new Error("Zero ray direction");
    for (let i = 0; i < 3; i++) {
      this.origin[i] = origin[i]!;
      this.direction[i] = direction[i]! / length;
    }
  }
  /** Unprojects viewport coordinates through perspective or orthographic camera matrices into a world-space ray. */
  fromCamera(camera: Camera, u: number, v: number, aspect: number): void {
    if (!Number.isFinite(u) || !Number.isFinite(v))
      throw new Error("Invalid screen coordinate");
    camera.update(aspect);
    Mat4.invert(this.inverse, camera.viewProjection);
    this.near[0] = u * 2 - 1;
    this.near[1] = 1 - v * 2;
    this.near[2] = 0;
    this.far.set(this.near);
    this.far[2] = 1;
    Mat4.transformPoint(this.near, this.inverse, this.near);
    Mat4.transformPoint(this.far, this.inverse, this.far);
    const origin =
      camera.projectionType === "perspective" ? camera.position : this.near;
    for (let i = 0; i < 3; i++) this.direction[i] = this.far[i]! - origin[i]!;
    this.set(origin, this.direction);
  }
}
