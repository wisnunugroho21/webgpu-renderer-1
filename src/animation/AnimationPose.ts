import { Quat } from "../math/Quat";
import { AnimationPath } from "./AnimationChannel";
/** Component-space pose seam for crossfade, override layers and local additive layers. */
export class AnimationPose {
  readonly values: Float32Array;
  private readonly delta = new Float32Array(4);
  private readonly weighted = new Float32Array(4);
  private readonly identity = new Float32Array([0, 0, 0, 1]);
  /** Initializes packed translation, rotation, scale and morph-weight pose storage. */
  constructor(
    readonly path: AnimationPath,
    size: number,
  ) {
    this.values = new Float32Array(size);
  }
  /** Copies a compatible packed pose into this retained pose buffer. */
  copy(values: ArrayLike<number>): void {
    for (let i = 0; i < this.values.length; i++) this.values[i] = values[i]!;
  }
  /** Interpolates translations/scales/morph weights and quaternion rotations between compatible poses. */
  blend(other: AnimationPose, weight: number): void {
    this.require(other, weight);
    if (this.path === "rotation")
      Quat.slerp(this.values, this.values, other.values, weight);
    else
      for (let i = 0; i < this.values.length; i++)
        this.values[i] =
          this.values[i]! * (1 - weight) + other.values[i]! * weight;
  }
  /** Local additive rotation: base * slerp(identity, inverse(reference) * pose, weight). */
  additive(
    pose: AnimationPose,
    reference: AnimationPose,
    weight: number,
  ): void {
    this.require(pose, weight);
    this.require(reference, weight);
    if (this.path === "rotation") {
      this.delta[0] = -reference.values[0]!;
      this.delta[1] = -reference.values[1]!;
      this.delta[2] = -reference.values[2]!;
      this.delta[3] = reference.values[3]!;
      Quat.multiply(this.delta, this.delta, pose.values);
      Quat.normalize(this.delta, this.delta);
      Quat.slerp(this.weighted, this.identity, this.delta, weight);
      Quat.multiply(this.values, this.values, this.weighted);
      Quat.normalize(this.values, this.values);
    } else
      for (let i = 0; i < this.values.length; i++) {
        if (this.path === "scale" && reference.values[i] !== 0)
          this.values[i]! *=
            1 + (pose.values[i]! / reference.values[i]! - 1) * weight;
        else
          this.values[i]! += (pose.values[i]! - reference.values[i]!) * weight;
      }
  }
  /** Rejects pose operations when packed layouts are incompatible. */
  private require(other: AnimationPose, weight: number): void {
    if (
      this.path !== other.path ||
      this.values.length !== other.values.length ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      weight > 1
    )
      throw new Error("Invalid pose blend");
  }
}
export interface AnimationLayer {
  clip: number;
  time: number;
  weight: number;
  mode: "override" | "additive";
  referenceTime?: number;
}
