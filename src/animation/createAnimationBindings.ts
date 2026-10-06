import type { World } from "../ecs/World";
import type { AnimationClip } from "./AnimationClip";
import type {
  AnimationBinding,
  AnimationSlot,
  MorphState,
} from "./AnimationBindings";
import { AnimationPose } from "./AnimationPose";

/** Resolve immutable clip channels into persistent controller-owned bindings and shared target slots. */
export function createAnimationBindings(
  clips: readonly AnimationClip[],
  world: World,
  entities: Int32Array,
  morphs: Map<number, MorphState>,
  slots: AnimationSlot[],
  initializeRest: (slot: AnimationSlot) => void,
): AnimationBinding[][] {
  const slotsByTarget = new Map<string, AnimationSlot>();
  const bindings = clips.map((clip) =>
    /** Bind each clip channel to one controller-owned pose slot. */ clip.channels.map(
      (channel) => {
        // Shared clips stay immutable; output storage and key hints belong to this controller.

        const entity = entities[channel.node] ?? -1,
          morph = morphs.get(entity),
          key = `${channel.node}:${channel.path}`;
        if (
          channel.path === "weights" &&
          entity >= 0 &&
          (!morph || morph.weights.length !== channel.sampler.size)
        )
          throw new Error("Animation morph weight count mismatch");
        let slot = slotsByTarget.get(key);
        if (!slot) {
          /** Allocate source/base/target/result poses once for each unique channel target. */
          const pose = () =>
            new AnimationPose(channel.path, channel.sampler.size);
          slot = {
            entity,
            node: channel.node,
            generation: world.generation[entity] ?? -1,
            morph,
            path: channel.path,
            base: pose(),
            source: pose(),
            target: pose(),
            result: pose(),
          };
          initializeRest(slot);
          slotsByTarget.set(key, slot);
          slots.push(slot);
        } else if (slot.base.values.length !== channel.sampler.size)
          throw new Error("Animation clip target size mismatch");
        return {
          channel,
          keyIndex: 0,
          slot,
          output: new Float32Array(channel.sampler.size),
        };
      },
    ),
  );
  return bindings;
}
