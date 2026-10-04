import { Camera } from "../Camera";
import { RenderWorld } from "../RenderWorld";
/** Exact snapshots favor correctness over approximate motion thresholds. Any motion resets. */
export class TemporalVisibility {
  enabled = false;
  reuse = false;
  newObjects = false;
  resetReason = "disabled";
  private valid = false;
  private initialized = false;
  private count = 0;
  private revision = -1;
  private width = 0;
  private height = 0;
  private skipLOD = false;
  private readonly camera = new Float32Array(32);
  private readonly entities: Uint32Array;
  private readonly generations: Float64Array;
  private readonly geometry: Float32Array;
  private readonly identities: Int32Array;
  private readonly joints: Float32Array;
  private readonly weights: Float32Array;
  private jointCount = 0;
  private weightCount = 0;
  constructor(world: RenderWorld) {
    this.entities = new Uint32Array(world.capacity).fill(0xffffffff);
    this.generations = new Float64Array(world.capacity);
    this.geometry = new Float32Array(world.capacity * 20);
    this.identities = new Int32Array(world.capacity * 9);
    this.joints = new Float32Array(world.jointMatrices.length);
    this.weights = new Float32Array(world.morphWeights.length);
  }
  prepare(
    world: RenderWorld,
    camera: Camera,
    revision: number,
    width: number,
    height: number,
    skipLOD: boolean,
  ): void {
    this.reuse = this.newObjects = false;
    if (!this.enabled) {
      this.valid = this.initialized = false;
      this.resetReason = "disabled";
      return;
    }
    let reason = this.initialized ? "" : "initial";
    if (
      this.width !== width ||
      this.height !== height ||
      this.skipLOD !== skipLOD
    )
      reason = "projection";
    for (let i = 0; i < 16; i++) {
      if (this.camera[i] !== camera.view[i]) reason = "camera";
      if (this.camera[16 + i] !== camera.projection[i]) reason = "projection";
      this.camera[i] = camera.view[i]!;
      this.camera[16 + i] = camera.projection[i]!;
    }
    if (this.count !== world.count) reason = "membership";
    for (let i = 0; i < world.count; i++) {
      if (
        !this.initialized ||
        this.entities[i] !== world.entityId[i] ||
        this.generations[i] !== world.entityGeneration[i]
      ) {
        this.newObjects = true;
        reason = "membership";
      }
      this.entities[i] = world.entityId[i]!;
      this.generations[i] = world.entityGeneration[i]!;
      for (let k = 0; k < 20; k++) {
        const value =
          k < 16 ? world.matrices[i * 16 + k]! : world.sphere[i * 4 + k - 16]!;
        if (this.geometry[i * 20 + k] !== value) reason = "motion";
        this.geometry[i * 20 + k] = value;
      }
      for (let k = 0; k < 9; k++) {
        const value =
          k === 0
            ? world.meshId[i]!
            : k === 1
              ? world.materialId[i]!
              : k === 2
                ? world.flags[i]!
                : k === 3
                  ? world.lodGroup[i]!
                  : k === 4
                    ? world.jointOffset[i]!
                    : k === 5
                      ? world.jointCounts[i]!
                      : k === 6
                        ? world.morphOffset[i]!
                        : k === 7
                          ? world.morphCounts[i]!
                          : world.transformIndex[i]!;
        if (this.identities[i * 9 + k] !== value) reason = "geometry";
        this.identities[i * 9 + k] = value;
      }
    }
    if (
      this.jointCount !== world.jointCount ||
      this.weightCount !== world.morphWeightCount
    )
      reason = "deformation";
    for (let i = 0; i < world.jointCount * 16; i++) {
      if (this.joints[i] !== world.jointMatrices[i]) reason = "deformation";
      this.joints[i] = world.jointMatrices[i]!;
    }
    for (let i = 0; i < world.morphWeightCount; i++) {
      if (this.weights[i] !== world.morphWeights[i]) reason = "deformation";
      this.weights[i] = world.morphWeights[i]!;
    }
    if (this.revision !== revision) reason = "material";
    this.reuse = this.valid && !reason;
    this.resetReason = this.reuse ? "none" : reason || "warmup";
    this.valid = !this.newObjects;
    this.initialized = true;
    this.count = world.count;
    this.revision = revision;
    this.width = width;
    this.height = height;
    this.skipLOD = skipLOD;
    this.jointCount = world.jointCount;
    this.weightCount = world.morphWeightCount;
    for (let i = world.count; i < this.entities.length; i++)
      this.entities[i] = 0xffffffff;
  }
}
