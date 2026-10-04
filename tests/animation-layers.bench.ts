import { bench, describe } from "vitest";
import { Animator } from "../src/animation/Animator";
import { AnimationClip } from "../src/animation/AnimationClip";
import { AnimationChannel } from "../src/animation/AnimationChannel";
import { AnimationSampler } from "../src/animation/AnimationSampler";
import { World } from "../src/ecs/World";
const clip = new AnimationClip("shared", [
  new AnimationChannel(
    0,
    "translation",
    new AnimationSampler(
      new Float32Array([0, 2]),
      new Float32Array([0, 0, 0, 2, 1, 0]),
      "LINEAR",
    ),
  ),
]);
describe("Optional animation layers", () => {
  // Groups checks for Optional animation layers.

  for (const layers of [0, 1, 4]) {
    const world = new World(1000),
      animators: Animator[] = [];
    for (let i = 0; i < 1000; i++) {
      const entity = world.create();
      world.transforms.add(entity);
      const animator = new Animator(
        [clip],
        world,
        new Int32Array([entity]),
        new Map(),
      );
      animator.play();
      animator.currentTime = (i * 2) / 1000;
      for (let layer = 0; layer < layers; layer++)
        animator.addLayer({
          clip: 0,
          mode: layer % 2 ? "additive" : "override",
          time: (i * 2) / 1000,
          weight: 0.5,
        });
      animators.push(animator);
    }
    bench(`1000 animators with ${layers} layers`, () => {
      // Measures Optional animation layers.

      for (const animator of animators) animator.update(1 / 60);
    });
  }
});
