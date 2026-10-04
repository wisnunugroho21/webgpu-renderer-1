import { ComponentStore } from "./ComponentStore";
export class MeshRendererStore extends ComponentStore {
  readonly meshId: Uint32Array;
  readonly materialId: Uint32Array;
  readonly flags: Uint32Array;
  readonly lodGroup: Int32Array;
  /** Initializes entity mesh/material IDs and authored LOD references. */
  constructor(capacity: number) {
    super(capacity);
    this.meshId = new Uint32Array(capacity);
    this.materialId = new Uint32Array(capacity);
    this.flags = new Uint32Array(capacity);
    this.lodGroup = new Int32Array(capacity).fill(-1);
  }
  /** Associates an entity with an authored LOD group while retaining its base mesh/material references. */
  setLOD(entity: number, group: number): void {
    if (!this.has[entity] || !Number.isInteger(group) || group < -1)
      throw new Error("Invalid LOD assignment");
    this.lodGroup[entity] = group;
  }
  /** Associates a live renderable component with shared mesh/material IDs and rendering flags. */
  set(entity: number, meshId: number, materialId: number, flags = 0): void {
    if (!this.has[entity]) this.lodGroup[entity] = -1;
    this.add(entity);
    this.meshId[entity] = meshId;
    this.materialId[entity] = materialId;
    this.flags[entity] = flags;
  }
}
