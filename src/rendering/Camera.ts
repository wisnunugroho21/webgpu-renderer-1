import { Mat4 } from "../math/Mat4";
import { Vec3 } from "../math/Vec3";
export interface PerspectiveOptions {
  fovY?: number;
  near?: number;
  far?: number;
  aspect?: number;
}
export interface OrthographicOptions {
  height?: number;
  near?: number;
  far?: number;
  aspect?: number;
}
/** Standard-Z projection. Omitted aspect follows the viewport; authored aspect stays fixed. */
export class Camera {
  readonly position = Vec3.create(3, 2, 5);
  readonly target = Vec3.create();
  readonly up = Vec3.create(0, 1, 0);
  readonly view = Mat4.create();
  readonly projection = Mat4.create();
  readonly viewProjection = Mat4.create();
  private dirty = true;
  private aspect = 0;
  private fixedAspect?: number;
  private kind: "perspective" | "orthographic" = "perspective";
  private zNear = 0.1;
  private zFar = 100;
  private fieldOfView = Math.PI / 3;
  private height = 10;
  /** Returns the selected perspective or orthographic projection type. */
  get projectionType(): "perspective" | "orthographic" {
    return this.kind;
  }
  /** Returns the near clipping distance in world units. */
  get near(): number {
    return this.zNear;
  }
  /** Returns the far clipping distance in world units. */
  get far(): number {
    return this.zFar;
  }
  /** Returns the perspective vertical field of view in radians. */
  get fovY(): number {
    return this.fieldOfView;
  }
  /** Returns the orthographic vertical view span in world units. */
  get orthographicHeight(): number {
    return this.height;
  }
  /** Copies camera pose and projection settings for resource recovery or controller handoff. */
  copyFrom(other: Camera): void {
    this.position.set(other.position);
    this.target.set(other.target);
    this.up.set(other.up);
    this.kind = other.kind;
    this.fixedAspect = other.fixedAspect;
    this.zNear = other.zNear;
    this.zFar = other.zFar;
    this.fieldOfView = other.fieldOfView;
    this.height = other.height;
    this.dirty = true;
  }
  /** Validates perspective options and selects vertical-FOV projection in radians. */
  setPerspective(options: PerspectiveOptions = {}): void {
    const near = options.near ?? 0.1,
      far = options.far ?? 100,
      fov = options.fovY ?? Math.PI / 3;
    this.validate(near, far, options.aspect);
    if (near <= 0 || !Number.isFinite(fov) || fov <= 0 || fov >= Math.PI)
      throw new Error("Invalid perspective camera");
    this.kind = "perspective";
    this.zNear = near;
    this.zFar = far;
    this.fieldOfView = fov;
    this.fixedAspect = options.aspect;
    this.dirty = true;
  }
  /** Validates orthographic options and selects a constant-height world-space projection. */
  setOrthographic(options: OrthographicOptions = {}): void {
    const near = options.near ?? 0.1,
      far = options.far ?? 100,
      height = options.height ?? 10;
    this.validate(near, far, options.aspect);
    if (!Number.isFinite(height) || height <= 0)
      throw new Error("Invalid orthographic camera");
    this.kind = "orthographic";
    this.zNear = near;
    this.zFar = far;
    this.height = height;
    this.fixedAspect = options.aspect;
    this.dirty = true;
  }
  /** Rejects nonfinite/invalid clipping, aspect and projection ranges. */
  private validate(near: number, far: number, aspect?: number): void {
    if (
      !Number.isFinite(near) ||
      !Number.isFinite(far) ||
      near < 0 ||
      far <= near ||
      (aspect !== undefined && (!Number.isFinite(aspect) || aspect <= 0))
    )
      throw new Error("Invalid camera projection");
  }
  /** Writes the finite world-space eye position. */
  setPosition(x: number, y: number, z: number): void {
    this.vector(this.position, x, y, z);
  }
  /** Writes the finite world-space look-at target. */
  setTarget(x: number, y: number, z: number): void {
    this.vector(this.target, x, y, z);
  }
  /** Writes the finite camera up vector used to construct the view basis. */
  setUp(x: number, y: number, z: number): void {
    if (Math.hypot(x, y, z) === 0) throw new Error("Invalid camera up");
    this.vector(this.up, x, y, z);
  }
  /** Validates and copies a three-component camera vector. */
  private vector(out: Float32Array, x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
      throw new Error("Invalid camera vector");
    if (out[0] === x && out[1] === y && out[2] === z) return;
    Vec3.set(out, x, y, z);
    this.dirty = true;
  }
  /** Rebuilds view, projection and combined matrices using the viewport aspect when no override is supplied. */
  update(viewportAspect: number): boolean {
    if (!Number.isFinite(viewportAspect) || viewportAspect <= 0)
      throw new Error("Invalid camera aspect");
    const aspect = this.fixedAspect ?? viewportAspect;
    if (!this.dirty && aspect === this.aspect) return false;
    Mat4.lookAt(this.view, this.position, this.target, this.up);
    if (this.kind === "perspective")
      Mat4.perspective(
        this.projection,
        this.fieldOfView,
        aspect,
        this.zNear,
        this.zFar,
      );
    else {
      const y = this.height / 2;
      Mat4.orthographic(
        this.projection,
        -y * aspect,
        y * aspect,
        -y,
        y,
        this.zNear,
        this.zFar,
      );
    }
    Mat4.multiply(this.viewProjection, this.projection, this.view);
    this.aspect = aspect;
    this.dirty = false;
    return true;
  }
}
