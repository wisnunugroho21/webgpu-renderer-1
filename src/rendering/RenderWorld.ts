/** Renderer-owned compact snapshot; no references to gameplay stores. */
export class RenderWorld {
  count = 0;
  lightCount = 0;
  readonly lightData: Float32Array;
  readonly lightEntity: Uint32Array;
  readonly lightShadow: Uint8Array;
  readonly lightDirty: Uint8Array;
  readonly lodGroup: Int32Array;
  readonly lodSelection: Int8Array;
  morphWeightCount = 0;
  activeMorphStates = 0;
  activeMorphTargets = 0;
  morphTargets = 0;
  readonly morphWeights: Float32Array;
  readonly morphDirty: Uint8Array;
  readonly morphDense: Uint8Array;
  readonly morphNonzeroCounts: Uint32Array;
  readonly morphActive: Uint8Array;
  readonly morphOffset: Uint32Array;
  readonly morphCounts: Uint32Array;
  jointCount = 0;
  activeSkeletons = 0;
  activeJoints = 0;
  readonly jointMatrices: Float32Array;
  readonly jointDirty: Uint8Array;
  readonly jointOffset: Uint32Array;
  readonly jointCounts: Uint32Array;
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
  constructor(
    readonly capacity: number,
    readonly jointCapacity = Math.max(1, capacity * 4),
    readonly morphCapacity = 65536,
    readonly lightCapacity = 1024,
  ) {
    this.lightData = new Float32Array(lightCapacity * 16);
    this.lightEntity = new Uint32Array(lightCapacity).fill(0xffffffff);
    this.lightShadow = new Uint8Array(lightCapacity);
    this.lightDirty = new Uint8Array(lightCapacity);
    this.lodGroup = new Int32Array(capacity).fill(-1);
    this.lodSelection = new Int8Array(capacity).fill(-2);
    this.morphWeights = new Float32Array(morphCapacity);
    this.morphDirty = new Uint8Array(morphCapacity);
    this.morphDense = new Uint8Array(capacity);
    this.morphNonzeroCounts = new Uint32Array(morphCapacity);
    this.morphActive = new Uint8Array(morphCapacity);
    this.morphOffset = new Uint32Array(capacity);
    this.morphCounts = new Uint32Array(capacity);
    this.jointMatrices = new Float32Array(jointCapacity * 16);
    this.jointDirty = new Uint8Array(jointCapacity);
    this.jointOffset = new Uint32Array(capacity);
    this.jointCounts = new Uint32Array(capacity);
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
