import { ComponentStore } from "./ComponentStore";
export class LightStore extends ComponentStore {
  readonly type: Uint8Array;
  readonly color: Float32Array;
  readonly intensity: Float32Array;
  readonly range: Float32Array;
  readonly innerCone: Float32Array;
  readonly outerCone: Float32Array;
  constructor(capacity: number) {
    super(capacity);
    this.type = new Uint8Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.intensity = new Float32Array(capacity);
    this.range = new Float32Array(capacity);
    this.innerCone = new Float32Array(capacity);
    this.outerCone = new Float32Array(capacity);
  }
}
