import { Camera } from "../rendering/Camera";
export interface OrbitOptions {
  minDistance?: number;
  maxDistance?: number;
  rotationSpeed?: number;
  zoomSpeed?: number;
}
/** Y-up orbit in CSS-pixel input units. Camera setters preserve projection caching. */
export class OrbitCameraController {
  readonly target = new Float32Array(3);
  protected yaw = 0;
  protected pitch = 0;
  protected distance = 1;
  private readonly min: number;
  private readonly max: number;
  private readonly rotation: number;
  private readonly zoom: number;
  constructor(
    protected readonly camera: Camera,
    options: OrbitOptions = {},
  ) {
    this.min = options.minDistance ?? 0.25;
    this.max = options.maxDistance ?? 100;
    this.rotation = options.rotationSpeed ?? 0.005;
    this.zoom = options.zoomSpeed ?? 0.001;
    if (
      !Number.isFinite(this.min) ||
      !Number.isFinite(this.max) ||
      this.min <= 0 ||
      this.max < this.min ||
      !Number.isFinite(this.rotation) ||
      this.rotation < 0 ||
      !Number.isFinite(this.zoom) ||
      this.zoom < 0
    )
      throw new Error("Invalid orbit options");
    this.syncFromCamera();
  }
  /** Call after an external camera teleport. Normal updates never query ECS or allocate frame storage. */
  syncFromCamera(): void {
    this.target.set(this.camera.target);
    const x = this.camera.position[0]! - this.target[0]!,
      y = this.camera.position[1]! - this.target[1]!,
      z = this.camera.position[2]! - this.target[2]!;
    const distance = Math.hypot(x, y, z);
    this.distance = Math.max(this.min, Math.min(this.max, distance));
    this.yaw = Math.atan2(x, z);
    this.pitch = this.clampPitch(Math.asin(distance > 0 ? y / distance : 0));
  }
  protected clampPitch(value: number): number {
    return Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, value));
  }
  protected rotate(dx: number, dy: number, wheel: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(wheel))
      throw new Error("Invalid orbit input");
    this.yaw = (this.yaw - dx * this.rotation) % (Math.PI * 2);
    this.pitch = this.clampPitch(this.pitch + dy * this.rotation);
    this.distance = Math.max(
      this.min,
      Math.min(
        this.max,
        this.distance *
          Math.exp(Math.max(-50, Math.min(50, wheel * this.zoom))),
      ),
    );
  }
  protected apply(heading = 0): void {
    const yaw = this.yaw + heading,
      horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.setTarget(this.target[0]!, this.target[1]!, this.target[2]!);
    this.camera.setPosition(
      this.target[0]! + Math.sin(yaw) * horizontal,
      this.target[1]! + Math.sin(this.pitch) * this.distance,
      this.target[2]! + Math.cos(yaw) * horizontal,
    );
    this.camera.setUp(0, 1, 0);
  }
  update(dx = 0, dy = 0, wheel = 0): void {
    this.rotate(dx, dy, wheel);
    this.apply();
  }
}
