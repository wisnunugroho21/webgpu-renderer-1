import { RenderWorld } from "../RenderWorld";
/** Exact persistent comparisons avoid stale maps from hash collisions and rotating equal-size bounds. */
export class ShadowSceneCache {
  private readonly transforms: Float32Array;
  private readonly boundsMin: Float32Array;
  private readonly boundsMax: Float32Array;
  private readonly records: Uint32Array;
  private readonly joints: Float32Array;
  private readonly weights: Float32Array;
  private objectCount = -1;
  private instanceCount = -1;
  private jointCount = -1;
  private morphCount = -1;
  private materialRevision = -1;
  /** Initializes shadow-relevant scene snapshots and reuse comparisons. */
  constructor(world: RenderWorld) {
    this.transforms = new Float32Array(world.matrices.length);
    this.boundsMin = new Float32Array(world.boundsMin.length);
    this.boundsMax = new Float32Array(world.boundsMax.length);
    this.records = new Uint32Array(world.capacity * 12);
    this.joints = new Float32Array(world.jointMatrices.length);
    this.weights = new Float32Array(world.morphWeights.length);
  }
  /** Stores the current shadow-relevant state after a valid comparison/update. */
  update(
    world: RenderWorld,
    records: Uint32Array,
    instances: number,
    materialRevision: number,
  ): boolean {
    let changed =
      this.objectCount !== world.count ||
      this.instanceCount !== instances ||
      this.jointCount !== world.jointCount ||
      this.morphCount !== world.morphWeightCount ||
      this.materialRevision !== materialRevision;
    changed =
      this.compare(this.transforms, world.matrices, world.count * 16) ||
      changed;
    changed =
      this.compare(this.boundsMin, world.boundsMin, world.count * 3) || changed;
    changed =
      this.compare(this.boundsMax, world.boundsMax, world.count * 3) || changed;
    changed = this.compare(this.records, records, instances * 12) || changed;
    changed =
      this.compare(this.joints, world.jointMatrices, world.jointCount * 16) ||
      changed;
    changed =
      this.compare(this.weights, world.morphWeights, world.morphWeightCount) ||
      changed;
    this.objectCount = world.count;
    this.instanceCount = instances;
    this.jointCount = world.jointCount;
    this.morphCount = world.morphWeightCount;
    this.materialRevision = materialRevision;
    return changed;
  }
  /** Detects membership, transform, material or deformation changes that prevent shadow-map reuse. */
  private compare(
    out: Float32Array | Uint32Array,
    input: Float32Array | Uint32Array,
    count: number,
  ): boolean {
    let changed = false;
    for (let i = 0; i < count; i++)
      if (out[i] !== input[i]) {
        out[i] = input[i]!;
        changed = true;
      }
    return changed;
  }
}
