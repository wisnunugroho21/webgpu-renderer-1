import { AnimationSampler } from "./AnimationSampler";
export type AnimationPath = "translation" | "rotation" | "scale" | "weights";
export class AnimationChannel {
  constructor(
    readonly node: number,
    readonly path: AnimationPath,
    readonly sampler: AnimationSampler,
  ) {
    if (
      !Number.isInteger(node) ||
      node < 0 ||
      !["translation", "rotation", "scale", "weights"].includes(path)
    )
      throw new Error("Invalid animation channel");
    if (sampler.rotation !== (path === "rotation"))
      throw new Error("Animation rotation sampler mismatch");
    if (path !== "weights" && sampler.size !== (path === "rotation" ? 4 : 3))
      throw new Error("Animation path/output mismatch");
  }
}
