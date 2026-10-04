import { ComponentStore } from "./ComponentStore";
export class SkinStore extends ComponentStore {
  readonly instanceId: Int32Array;
  /** Initializes entity-to-skeleton-instance membership. */
  constructor(capacity: number) {
    super(capacity);
    this.instanceId = new Int32Array(capacity).fill(-1);
  }
  /** Clears the requested membership/reference in entity-to-skeleton-instance membership. */
  override remove(entity: number): void {
    super.remove(entity);
    this.instanceId[entity] = -1;
  }
}
