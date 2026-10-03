import { bench, describe } from "vitest";
import { AnimationSampler } from "../src/animation/AnimationSampler";
import { AnimationChannel } from "../src/animation/AnimationChannel";
import { AnimationClip } from "../src/animation/AnimationClip";
import { Animator } from "../src/animation/Animator";
import { World } from "../src/ecs/World";
const world = new World(10000),
  times = new Float32Array([0, 1]),
  values = new Float32Array([0, 0, 0, 1, 2, 3]);
const clip = new AnimationClip("Shared TRS", [
  new AnimationChannel(
    0,
    "translation",
    new AnimationSampler(times, values, "LINEAR"),
  ),
  new AnimationChannel(
    0,
    "scale",
    new AnimationSampler(times, new Float32Array([1, 1, 1, 2, 2, 2]), "LINEAR"),
  ),
  new AnimationChannel(
    0,
    "rotation",
    new AnimationSampler(
      times,
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 0]),
      "LINEAR",
      true,
    ),
  ),
]);
const animators: Animator[] = [];
for (let i = 0; i < 10000; i++) {
  const e = world.create();
  world.transforms.add(e);
  const a = new Animator([clip], world, new Int32Array([e]), new Map());
  a.play();
  animators.push(a);
}
describe("Phase 16 animation sampling", () => {
  for (const count of [100, 1000, 10000])
    bench(`${count} independent animators, shared TRS clip`, () => {
      for (let i = 0; i < count; i++) animators[i]!.update(1 / 60);
    });
});
