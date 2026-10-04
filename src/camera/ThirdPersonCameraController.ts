import { Camera } from "../rendering/Camera";
import {
  OrbitCameraController,
  type OrbitOptions,
} from "./OrbitCameraController";
export interface FollowOptions extends OrbitOptions {
  height?: number;
  followSpeed?: number;
}
/** Follow a gameplay position with frame-rate independent exponential smoothing and heading-relative orbit. */
export class ThirdPersonCameraController extends OrbitCameraController {
  private readonly height: number;
  private readonly speed: number;
  constructor(camera: Camera, options: FollowOptions = {}) {
    super(camera, options);
    this.height = options.height ?? 1;
    this.speed = options.followSpeed ?? 8;
    if (
      !Number.isFinite(this.height) ||
      !Number.isFinite(this.speed) ||
      this.speed < 0
    )
      throw new Error("Invalid follow options");
  }
  /** snap handles spawning/teleports; heading rotates the camera offset around world Y. Collision belongs to gameplay. */
  follow(
    dt: number,
    position: ArrayLike<number>,
    heading = 0,
    dx = 0,
    dy = 0,
    wheel = 0,
    snap = false,
  ): void {
    const x = position[0],
      y = position[1],
      z = position[2];
    if (
      !Number.isFinite(dt) ||
      dt < 0 ||
      x === undefined ||
      y === undefined ||
      z === undefined ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(heading)
    )
      throw new Error("Invalid follow pose");
    this.rotate(dx, dy, wheel);
    const blend = snap ? 1 : -Math.expm1(-this.speed * dt);
    this.target[0] = this.target[0]! + (x - this.target[0]!) * blend;
    this.target[1] =
      this.target[1]! + (y + this.height - this.target[1]!) * blend;
    this.target[2] = this.target[2]! + (z - this.target[2]!) * blend;
    this.apply(heading);
  }
}
