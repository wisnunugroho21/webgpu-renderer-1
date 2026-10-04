export class ComponentStore {
  readonly has: Uint8Array;
  /** Initializes bounded component membership flags. */
  constructor(readonly capacity: number) {
    this.has = new Uint8Array(capacity);
  }
  /** Marks component membership after checking the entity index fits the fixed capacity. */
  add(entity: number): void {
    if (!Number.isInteger(entity) || entity < 0 || entity >= this.capacity)
      throw new Error("Invalid component entity");
    this.has[entity] = 1;
  }
  /** Clears component membership without reallocating its data arrays. */
  remove(entity: number): void {
    this.has[entity] = 0;
  }
}
