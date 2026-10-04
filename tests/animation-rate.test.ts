import { expect, it } from "vitest";
import { World } from "../src/ecs/World";
import { Animator } from "../src/animation/Animator";
import { AnimationClip } from "../src/animation/AnimationClip";
import { AnimationChannel } from "../src/animation/AnimationChannel";
import { AnimationSampler } from "../src/animation/AnimationSampler";
/** Builds controlled test dependencies and reusable state for animation-rate. */
function fixture() {
  const world = new World(2),
    entity = world.create();
  world.transforms.add(entity);
  const clip = new AnimationClip("move", [
    new AnimationChannel(
      0,
      "translation",
      new AnimationSampler(
        new Float32Array([0, 1]),
        new Float32Array([0, 0, 0, 1, 0, 0]),
        "LINEAR",
      ),
    ),
  ]);
  const animator = new Animator(
    [clip, clip],
    world,
    new Int32Array([entity]),
    new Map(),
  );
  animator.play();
  return { world, entity, animator };
}
it("advances full-rate clocks while holding explicit reduced-rate visual poses", () => {
  // Verifies advances full-rate clocks while holding explicit reduced-rate visual poses.

  const { world, entity, animator } = fixture();
  animator.evaluationInterval = 1 / 15;
  const start = animator.evaluations;
  for (let i = 0; i < 3; i++) animator.update(1 / 60);
  expect(animator.currentTime).toBeCloseTo(0.05);
  expect(world.transforms.positionX[entity]).toBe(0);
  expect(animator.evaluations).toBe(start);
  animator.update(1 / 60);
  expect(world.transforms.positionX[entity]).toBeCloseTo(1 / 15);
  expect(animator.evaluations).toBe(start + 1);
  animator.pause();
  animator.update(1);
  expect(animator.currentTime).toBeCloseTo(1 / 15);
  animator.currentTime = 0.5;
  expect(world.transforms.positionX[entity]).toBe(0.5);
});
it("forces terminal and crossfade endpoint poses and validates quality controls", () => {
  // Verifies forces terminal and crossfade endpoint poses and validates quality controls.

  const { world, entity, animator } = fixture();
  animator.evaluationInterval = 1;
  animator.loop = false;
  animator.currentTime = 0.99;
  animator.update(0.02);
  expect(animator.playing).toBe(false);
  expect(world.transforms.positionX[entity]).toBe(1);
  animator.crossFade(1, 0.01);
  animator.update(0.02);
  expect(animator.crossfading).toBe(false);
  expect(world.transforms.positionX[entity]).toBeCloseTo(0.02);
  for (const value of [-1, NaN, Infinity, 1.1])
    expect(
      () =>
        /** Computes the animator.evaluationInterval = value result. */ (animator.evaluationInterval =
          value),
    ).toThrow();
  for (const value of [-1, NaN, 1])
    expect(
      () =>
        /** Computes the animator.evaluationPhase = value result. */ (animator.evaluationPhase =
          value),
    ).toThrow();
});
it("staggering distributes evaluations without changing playback time", () => {
  // Verifies staggering distributes evaluations without changing playback time.

  const a = fixture().animator,
    b = fixture().animator;
  a.evaluationInterval = b.evaluationInterval = 1 / 30;
  b.evaluationPhase = 0.5;
  const first = a.evaluations,
    second = b.evaluations;
  a.update(1 / 60);
  b.update(1 / 60);
  expect(a.evaluations).toBe(first);
  expect(b.evaluations).toBe(second + 1);
  expect(a.currentTime).toBe(b.currentTime);
});
