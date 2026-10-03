import { ComponentStore } from "./ComponentStore";
export class MorphStore extends ComponentStore {
  readonly stateId: Int32Array;
  constructor(capacity: number) {
    super(capacity);
    this.stateId = new Int32Array(capacity).fill(-1);
  }
}
