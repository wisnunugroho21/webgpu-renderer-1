import { ComponentStore } from "./ComponentStore";
export class MorphStore extends ComponentStore {
  readonly stateId: Int32Array;
  /** Initializes entity-to-morph-state membership. */
  constructor(capacity: number) {
    super(capacity);
    this.stateId = new Int32Array(capacity).fill(-1);
  }
  /** Clears the requested membership/reference in entity-to-morph-state membership. */
  override remove(entity: number): void {
    super.remove(entity);
    this.stateId[entity] = -1;
  }
}
