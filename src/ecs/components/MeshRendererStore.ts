import { ComponentStore } from "./ComponentStore";
export class MeshRendererStore extends ComponentStore {
  readonly meshId: Uint32Array;
  readonly materialId: Uint32Array;
  readonly flags: Uint32Array;
  constructor(capacity: number) {
    super(capacity);
    this.meshId = new Uint32Array(capacity);
    this.materialId = new Uint32Array(capacity);
    this.flags = new Uint32Array(capacity);
  }
  set(entity: number, meshId: number, materialId: number, flags = 0): void {
    this.add(entity);
    this.meshId[entity] = meshId;
    this.materialId[entity] = materialId;
    this.flags[entity] = flags;
  }
}
