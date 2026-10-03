import { expect, it } from "vitest";
import {
  AnimationSampler,
  Interpolation,
} from "../src/animation/AnimationSampler";
import { AnimationChannel } from "../src/animation/AnimationChannel";
import { AnimationClip } from "../src/animation/AnimationClip";
import { Animator, MorphState } from "../src/animation/Animator";
import { World } from "../src/ecs/World";

function data(size: number, mode: Interpolation) {
  const times = Float32Array.from({ length: 129 }, (_, i) => 1 + (i * i) / 512);
  const values = Float32Array.from(
    { length: times.length * size * (mode === "CUBICSPLINE" ? 3 : 1) },
    (_, i) => Math.sin(i * 0.73),
  );
  return { times, values };
}

for (const mode of ["STEP", "LINEAR", "CUBICSPLINE"] as const)
  for (const size of [3, 4, 16])
    it(`${mode}/${size}: hinted samples exactly match binary search through boundaries and jumps`, () => {
      const { times, values } = data(size, mode);
      const sampler = new AnimationSampler(times, values, mode, size === 4);
      const expected = new Float32Array(size),
        actual = new Float32Array(size);
      const queries = [-10, ...times, ...Array.from(times).reverse(), 100];
      for (let i = 0; i < 400; i++) queries.push(((i * 17.713) % 35) - 1);
      // Three independently phased callers share one immutable sampler.
      const hints = [0, 50, 128];
      for (const query of queries)
        for (let instance = 0; instance < 3; instance++) {
          const time = query + instance * 0.001;
          sampler.sample(time, expected);
          hints[instance] = sampler.sample(time, actual, hints[instance]);
          expect(actual).toEqual(expected);
          expect(hints[instance]).toBeGreaterThanOrEqual(0);
          expect(hints[instance]).toBeLessThan(times.length);
        }
      for (const hint of [NaN, Infinity, -999, 999, 2.5]) {
        sampler.sample(7, expected);
        sampler.sample(7, actual, hint);
        expect(actual).toEqual(expected);
      }
    });

it("handles one-key clips and invalid sampling arguments with a hint", () => {
  const sampler = new AnimationSampler(
    new Float32Array([2]),
    new Float32Array([7]),
    "STEP",
  );
  const out = new Float32Array(1);
  expect(sampler.sample(-1, out, 999)).toBe(0);
  expect(out[0]).toBe(7);
  expect(sampler.sample(20, out, 0)).toBe(0);
  expect(() => sampler.sample(NaN, out, 0)).toThrow();
  expect(() => sampler.sample(0, new Float32Array(0), 0)).toThrow();
});

it("preserves long-clip playback, independent phases, reverse loops and interrupted fades", () => {
  class Stateless extends AnimationSampler {
    override sample(time: number, out: Float32Array): number {
      return super.sample(time, out);
    }
  }
  const setup = (Sampler: typeof AnimationSampler) => {
    const world = new World(3),
      animators: Animator[] = [],
      morphs: MorphState[] = [];
    const clips = ["LINEAR", "CUBICSPLINE", "STEP"].map((mode) => {
      const channels = (
        ["translation", "rotation", "scale", "weights"] as const
      ).map((path) => {
        const size = path === "rotation" ? 4 : path === "weights" ? 16 : 3;
        const { times, values } = data(size, mode as Interpolation);
        return new AnimationChannel(
          0,
          path,
          new Sampler(
            times,
            values,
            mode as Interpolation,
            path === "rotation",
          ),
        );
      });
      return new AnimationClip(mode, channels);
    });
    for (let i = 0; i < 3; i++) {
      const entity = world.create();
      world.transforms.add(entity);
      const morph = {
        weightOffset: i * 16,
        targetCount: 16,
        weights: new Float32Array(16),
        dirty: false,
      };
      morphs.push(morph);
      const animator = new Animator(
        clips,
        world,
        new Int32Array([entity]),
        new Map([[entity, morph]]),
      );
      animator.play();
      animator.currentTime = i * 7.5;
      animators.push(animator);
    }
    return { world, animators, morphs };
  };
  const hinted = setup(AnimationSampler),
    reference = setup(Stateless);
  for (let frame = 0; frame < 180; frame++) {
    for (const scene of [hinted, reference])
      for (const [i, animator] of scene.animators.entries()) {
        if (frame === 20) animator.crossFade(1, 0.7);
        if (frame === 25) animator.crossFade(2, 0.3);
        if (frame === 60) animator.currentTime = 29 - i;
        if (frame === 70) animator.speed = -3;
        if (frame === 95) animator.crossFade(0, 0.2);
        if (frame === 120) {
          animator.stop();
          animator.play(1);
        }
        animator.update(frame === 150 ? 17 : 1 / 60);
      }
    for (const field of [
      "positionX",
      "positionY",
      "positionZ",
      "rotationX",
      "rotationY",
      "rotationZ",
      "rotationW",
      "scaleX",
      "scaleY",
      "scaleZ",
    ] as const)
      expect(hinted.world.transforms[field]).toEqual(
        reference.world.transforms[field],
      );
    for (let i = 0; i < 3; i++) {
      expect(hinted.morphs[i]!.weights).toEqual(reference.morphs[i]!.weights);
      expect(hinted.animators[i]!.currentTime).toBe(
        reference.animators[i]!.currentTime,
      );
      expect(hinted.animators[i]!.crossfading).toBe(
        reference.animators[i]!.crossfading,
      );
    }
  }
});
