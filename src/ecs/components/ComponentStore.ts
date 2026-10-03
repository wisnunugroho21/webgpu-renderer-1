export class ComponentStore {
  readonly has: Uint8Array;
  constructor(readonly capacity: number) {
    this.has = new Uint8Array(capacity);
  }
  add(entity: number): void {
    if (!Number.isInteger(entity) || entity < 0 || entity >= this.capacity)
      throw new Error("Invalid component entity");
    this.has[entity] = 1;
  }
  remove(entity: number): void {
    this.has[entity] = 0;
  }
}
