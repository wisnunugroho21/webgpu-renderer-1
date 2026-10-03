import { ComponentStore } from "./ComponentStore";
export class CameraStore extends ComponentStore {
  readonly fovY: Float32Array;
  readonly near: Float32Array;
  readonly far: Float32Array;
  constructor(capacity: number) {
    super(capacity);
    this.fovY = new Float32Array(capacity).fill(Math.PI / 3);
    this.near = new Float32Array(capacity).fill(0.1);
    this.far = new Float32Array(capacity).fill(100);
  }
}
