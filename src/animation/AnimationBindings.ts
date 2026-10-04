import { AnimationClip } from "./AnimationClip";
import { AnimationChannel, AnimationPath } from "./AnimationChannel";
import { AnimationPose } from "./AnimationPose";
import {
  AnimationLayerOptions,
  AnimationLayerPlayback,
} from "./AnimationLayerPlayback";
export interface MorphState {
  readonly weightOffset: number;
  readonly targetCount: number;
  readonly weights: Float32Array;
  dirty: boolean;
}
export interface AnimationSlot {
  node: number;
  path: AnimationPath;
  entity: number;
  generation: number;
  morph?: MorphState;
  base: AnimationPose;
  source: AnimationPose;
  target: AnimationPose;
  result: AnimationPose;
  layered?: AnimationPose;
}
export interface AnimationBinding {
  channel: AnimationChannel;
  output: Float32Array;
  keyIndex: number;
  slot: AnimationSlot;
}
export interface AnimationLayerBinding extends AnimationBinding {
  pose: AnimationPose;
  reference: AnimationPose;
}
export interface AnimationLayerState {
  playback: AnimationLayerPlayback;
  bindings: AnimationLayerBinding[];
}
/** Cold layer installation resolves masks/reference poses once; composition stays in Animator's frame loop. */
export function createAnimationLayer(
  options: AnimationLayerOptions,
  clips: readonly AnimationClip[],
  clipBindings: AnimationBinding[][],
  slots: readonly AnimationSlot[],
): AnimationLayerState {
  const clip = clips[options.clip];
  if (!clip) throw new Error("Unknown animation layer clip");
  const playback = new AnimationLayerPlayback(options, clip.duration);
  const nodes = playback.nodes ? new Set(playback.nodes) : undefined;
  const bindings = clipBindings[playback.clip]!.filter(
    (binding) => !nodes || nodes.has(binding.channel.node),
  ).map((binding) => {
    const pose = new AnimationPose(binding.channel.path, binding.output.length);
    const reference = new AnimationPose(
      binding.channel.path,
      binding.output.length,
    );
    binding.channel.sampler.sample(playback.referenceTime, reference.values);
    return {
      channel: binding.channel,
      slot: binding.slot,
      output: pose.values,
      keyIndex: 0,
      pose,
      reference,
    };
  });
  for (const slot of slots)
    slot.layered ??= new AnimationPose(slot.path, slot.base.values.length);

  return { playback, bindings };
}
