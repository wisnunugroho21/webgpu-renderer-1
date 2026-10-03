/** Renderer-owned compact snapshot; no references to gameplay stores. */
export class RenderWorld {
  count = 0;
  staticRevision = 0;
  readonly entityId: Uint32Array;
  readonly meshId: Uint32Array;
  readonly materialId: Uint32Array;
  readonly flags: Uint32Array;
  readonly transformIndex: Uint32Array;
  readonly boundsIndex: Uint32Array;
  readonly skinInstanceId: Int32Array;
  readonly morphStateId: Int32Array;
  readonly matrices: Float32Array;
  readonly sphere: Float32Array;
  readonly boundsMin: Float32Array;
  readonly boundsMax: Float32Array;
  constructor(readonly capacity: number) {
    this.entityId = new Uint32Array(capacity);
    this.meshId = new Uint32Array(capacity);
    this.materialId = new Uint32Array(capacity);
    this.flags = new Uint32Array(capacity);
    this.transformIndex = new Uint32Array(capacity);
    this.boundsIndex = new Uint32Array(capacity);
    this.skinInstanceId = new Int32Array(capacity).fill(-1);
    this.morphStateId = new Int32Array(capacity).fill(-1);
    this.matrices = new Float32Array(capacity * 16);
    this.sphere = new Float32Array(capacity * 4);
    this.boundsMin = new Float32Array(capacity * 3);
    this.boundsMax = new Float32Array(capacity * 3);
  }
}
