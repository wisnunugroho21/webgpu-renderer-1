import {
  Camera,
  PerspectiveOptions,
  OrthographicOptions,
} from "../../rendering/Camera";
import { ComponentStore } from "./ComponentStore";
export class CameraStore extends ComponentStore {
  private readonly validation = new Camera();
  readonly type: Uint8Array;
  readonly height: Float32Array;
  readonly aspect: Float32Array;
  readonly fovY: Float32Array;
  readonly near: Float32Array;
  readonly far: Float32Array;
  constructor(capacity: number) {
    super(capacity);
    this.type = new Uint8Array(capacity);
    this.height = new Float32Array(capacity).fill(10);
    this.aspect = new Float32Array(capacity);
    this.fovY = new Float32Array(capacity).fill(Math.PI / 3);
    this.near = new Float32Array(capacity).fill(0.1);
    this.far = new Float32Array(capacity).fill(100);
  }
  setPerspective(entity: number, options: PerspectiveOptions = {}): void {
    const camera = this.validation;
    camera.setPerspective(options);
    this.add(entity);
    this.type[entity] = 0;
    this.fovY[entity] = camera.fovY;
    this.near[entity] = camera.near;
    this.far[entity] = camera.far;
    this.aspect[entity] = options.aspect ?? 0;
  }
  setOrthographic(entity: number, options: OrthographicOptions = {}): void {
    const camera = this.validation;
    camera.setOrthographic(options);
    this.add(entity);
    this.type[entity] = 1;
    this.height[entity] = camera.orthographicHeight;
    this.near[entity] = camera.near;
    this.far[entity] = camera.far;
    this.aspect[entity] = options.aspect ?? 0;
  }
}
