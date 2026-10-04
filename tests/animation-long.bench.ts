import { bench, describe } from "vitest";
import {
  AnimationSampler,
  Interpolation,
} from "../src/animation/AnimationSampler";
import { AnimationChannel } from "../src/animation/AnimationChannel";
import { AnimationClip } from "../src/animation/AnimationClip";
import { Animator, MorphState } from "../src/animation/Animator";
import { World } from "../src/ecs/World";

function curve(
  size: number,
  keys: number,
  mode: Interpolation,
  rotation = false,
) {
  const times = Float32Array.from(
    { length: keys },
    (_, k) => (k * 30) / (keys - 1),
  );
  const cubic = mode === "CUBICSPLINE";
  const values = new Float32Array(keys * size * (cubic ? 3 : 1));
  for (let k = 0; k < keys; k++) {
    const offset = k * size * (cubic ? 3 : 1) + (cubic ? size : 0);
    for (let axis = 0; axis < size; axis++)
      values[offset + axis] = Math.sin(times[k]! * 0.8 + axis);
    if (rotation) {
      values[offset] = values[offset + 1] = 0;
      values[offset + 2] = Math.sin(times[k]! * 0.05);
      values[offset + 3] = Math.cos(times[k]! * 0.05);
    }
  }
  return new AnimationSampler(times, values, mode, rotation);
}

function crowd(
  joints: number,
  keys: number,
  mode: Interpolation,
  morph: boolean,
) {
  const world = new World(1000 * joints);
  const channels: AnimationChannel[] = [];
  const rotation = curve(4, keys, mode, true);
  for (let node = 0; node < joints; node++)
    channels.push(new AnimationChannel(node, "rotation", rotation));
  if (morph) {
    channels.push(new AnimationChannel(0, "translation", curve(3, keys, mode)));
    channels.push(new AnimationChannel(0, "scale", curve(3, keys, mode)));
    channels.push(new AnimationChannel(0, "weights", curve(16, keys, mode)));
  }
  const clips = [
    new AnimationClip("long", channels),
    new AnimationClip("fade", channels),
  ];
  const animators: Animator[] = [];
  for (let i = 0; i < 1000; i++) {
    const entities = new Int32Array(joints);
    for (let joint = 0; joint < joints; joint++) {
      entities[joint] = world.create();
      world.transforms.add(entities[joint]!);
    }
    const morphs = new Map<number, MorphState>();
    if (morph)
      morphs.set(entities[0]!, {
        weightOffset: i * 16,
        targetCount: 16,
        weights: new Float32Array(16),
        dirty: false,
      });
    const animator = new Animator(clips, world, entities, morphs);
    animator.play();
    animator.currentTime = (i * 30) / 1000;
    animators.push(animator);
  }
  const update = (count: number) => {
    // Dirty-list consumption is included, but matrix propagation/GPU stages are excluded.
    world.transforms.dirty.fill(0);
    world.transforms.queued.fill(0);
    world.transforms.dirtyCount = 0;
    for (let i = 0; i < count; i++) animators[i]!.update(1 / 60);
  };
  return { update, animators };
}

describe("Long clips with 1000 unique phases", () => {
  const rotations = crowd(64, 1024, "LINEAR", false);
  for (const count of [100, 500, 1000])
    bench(`${count} characters x 64 joints, 1024 LINEAR keys`, () =>
      rotations.update(count),
    );
  for (const mode of ["STEP", "LINEAR", "CUBICSPLINE"] as const) {
    const mixed = crowd(1, 256, mode, true);
    bench(`1000 TRS + 16 morph weights, 256 ${mode} keys`, () =>
      mixed.update(1000),
    );
    const fading = crowd(1, 256, mode, true);
    // Keep fades alive across benchmark iterations; both clips have independent bindings.
    for (const animator of fading.animators) animator.crossFade(1, 1e9);
    bench(`1000 TRS + morph crossfades, 256 ${mode} keys`, () =>
      fading.update(1000),
    );
  }
});

const sampledCrowd = crowd(64, 1024, "LINEAR", false);
for (let i = 0; i < sampledCrowd.animators.length; i++) {
  const animator = sampledCrowd.animators[i]!;
  animator.evaluationInterval = 1 / 15;
  animator.evaluationPhase = i / sampledCrowd.animators.length;
}
bench("1000 x 64 joints, explicit staggered 15 Hz poses / 60 Hz clocks", () =>
  sampledCrowd.update(1000),
);
