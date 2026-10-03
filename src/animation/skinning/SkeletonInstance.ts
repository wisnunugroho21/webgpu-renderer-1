import { SkeletonAsset } from "./SkeletonAsset";
/** Dynamic instance data; no GPU buffer belongs to a character. */
export class SkeletonInstance {
  readonly jointEntities: Int32Array;
  readonly currentPose: Float32Array;
  readonly matrices: Float32Array;
  readonly inverseMesh = new Float32Array(16);
  readonly meshWorld = new Float32Array(16).fill(NaN);
  readonly poseViews: readonly Float32Array[];
  readonly matrixViews: readonly Float32Array[];
  readonly dirtyJoints: Uint8Array;
  jointOffset = -1;
  readonly jointCount: number;
  constructor(
    readonly asset: SkeletonAsset,
    readonly meshEntity: number,
    entities: Int32Array,
  ) {
    this.jointCount = asset.jointCount;
    this.jointEntities = Int32Array.from(
      asset.joints,
      (node) => entities[node] ?? -1,
    );
    if (this.jointEntities.some((e) => e < 0))
      throw new Error("Skeleton joint is outside the instantiated scene");
    this.currentPose = new Float32Array(this.jointCount * 16);
    this.matrices = new Float32Array(this.jointCount * 16);
    this.poseViews = Array.from({ length: this.jointCount }, (_, i) =>
      this.currentPose.subarray(i * 16, i * 16 + 16),
    );
    this.matrixViews = Array.from({ length: this.jointCount }, (_, i) =>
      this.matrices.subarray(i * 16, i * 16 + 16),
    );
    this.dirtyJoints = new Uint8Array(this.jointCount);
    for (let i = 0; i < this.jointCount; i++) {
      this.currentPose[i * 16] =
        this.currentPose[i * 16 + 5] =
        this.currentPose[i * 16 + 10] =
        this.currentPose[i * 16 + 15] =
          1;
      this.matrices.set(this.currentPose.subarray(i * 16, i * 16 + 16), i * 16);
    }
    this.currentPose.fill(NaN);
  }
}
