import { Mat4 } from "../math/Mat4";
import { Vec3 } from "../math/Vec3";
export class Camera {
  readonly position = Vec3.create(3, 2, 5);
  readonly target = Vec3.create();
  readonly up = Vec3.create(0, 1, 0);
  readonly view = Mat4.create();
  readonly projection = Mat4.create();
  readonly viewProjection = Mat4.create();
  private dirty = true;
  private aspect = 0;
  setPosition(x: number, y: number, z: number): void {
    Vec3.set(this.position, x, y, z);
    this.dirty = true;
  }
  setTarget(x: number, y: number, z: number): void {
    Vec3.set(this.target, x, y, z);
    this.dirty = true;
  }
  update(aspect: number): boolean {
    if (!this.dirty && aspect === this.aspect) return false;
    Mat4.lookAt(this.view, this.position, this.target, this.up);
    Mat4.perspective(this.projection, Math.PI / 3, aspect, 0.1, 100);
    Mat4.multiply(this.viewProjection, this.projection, this.view);
    this.aspect = aspect;
    this.dirty = false;
    return true;
  }
}
