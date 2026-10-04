import { ComponentStore } from "./ComponentStore";
export class AnimatorStore extends ComponentStore {
  readonly animatorId: Int32Array;
  /** Initializes entity-to-animation-controller membership. */
  constructor(capacity: number) {
    super(capacity);
    this.animatorId = new Int32Array(capacity).fill(-1);
  }
  /** Clears the requested membership/reference in entity-to-animation-controller membership. */
  override remove(entity: number): void {
    super.remove(entity);
    this.animatorId[entity] = -1;
  }
}
