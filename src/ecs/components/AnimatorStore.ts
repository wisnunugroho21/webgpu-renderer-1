import { ComponentStore } from "./ComponentStore";
export class AnimatorStore extends ComponentStore {
  readonly animatorId: Int32Array;
  constructor(capacity: number) {
    super(capacity);
    this.animatorId = new Int32Array(capacity).fill(-1);
  }
}
