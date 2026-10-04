import { ComponentStore } from "./ComponentStore";
export class SkinStore extends ComponentStore {
  readonly instanceId: Int32Array;
  constructor(capacity: number) {
    super(capacity);
    this.instanceId = new Int32Array(capacity).fill(-1);
  }
  override remove(entity: number): void {
    super.remove(entity);
    this.instanceId[entity] = -1;
  }
}
