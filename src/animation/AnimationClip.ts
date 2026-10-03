import { RuntimeAsset } from "../assets/gltf/RuntimeAsset";
import { AnimationChannel, AnimationPath } from "./AnimationChannel";
import { AnimationSampler, Interpolation } from "./AnimationSampler";
export class AnimationClip {
  readonly duration: number;
  constructor(
    readonly name: string,
    readonly channels: readonly AnimationChannel[],
  ) {
    this.duration = channels.reduce(
      (duration, c) => Math.max(duration, c.sampler.duration),
      0,
    );
    const targets = new Set<string>();
    for (const c of channels) {
      const key = `${c.node}:${c.path}`;
      if (targets.has(key)) throw new Error("Duplicate animation target");
      targets.add(key);
    }
  }
  static fromAsset(
    animation: RuntimeAsset["animations"][number],
  ): AnimationClip {
    return new AnimationClip(
      animation.name,
      animation.channels.map(
        (c) =>
          new AnimationChannel(
            c.node,
            c.path as AnimationPath,
            new AnimationSampler(
              c.input,
              c.output,
              c.interpolation as Interpolation,
              c.path === "rotation",
            ),
          ),
      ),
    );
  }
}
