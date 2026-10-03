import { describe, it, expect } from "vitest";
import { AnimationPose } from "../src/animation/AnimationPose";
import { AnimationClip } from "../src/animation/AnimationClip";
import { AnimationChannel } from "../src/animation/AnimationChannel";
import { AnimationSampler } from "../src/animation/AnimationSampler";
import { Animator, MorphState } from "../src/animation/Animator";
import { World } from "../src/ecs/World";
const pose = (
  path: "translation" | "rotation" | "scale" | "weights",
  values: number[],
) => {
  const p = new AnimationPose(path, values.length);
  p.copy(values);
  return p;
};
describe("component-space pose blending", () => {
  it("blends TRS and negative morph weights without matrix interpolation", () => {
    const p = pose("translation", [0, 0, 0]);
    p.blend(pose("translation", [2, 4, 6]), 0.5);
    expect(p.values).toEqual(new Float32Array([1, 2, 3]));
    const q = pose("rotation", [0, 0, 0, 1]);
    q.blend(pose("rotation", [0, 0, 1, 0]), 0.5);
    expect(q.values[2]).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(...q.values)).toBeCloseTo(1);
    const w = pose("weights", [-1, 1]);
    w.blend(pose("weights", [1, 0]), 0.5);
    expect(w.values).toEqual(new Float32Array([0, 0.5]));
    const scale = pose("scale", [1, 1, 1]);
    scale.blend(pose("scale", [3, 3, 3]), 0.5);
    expect(scale.values).toEqual(new Float32Array([2, 2, 2]));
  });
  it("supports reference-relative additive translation, scale, quaternion and weights", () => {
    const p = pose("translation", [10, 0, 0]);
    p.additive(
      pose("translation", [3, 0, 0]),
      pose("translation", [1, 0, 0]),
      0.5,
    );
    expect(p.values[0]).toBe(11);
    const s = pose("scale", [2, 2, 2]);
    s.additive(pose("scale", [4, 4, 4]), pose("scale", [2, 2, 2]), 0.5);
    expect(s.values[0]).toBe(3);
    const q = pose("rotation", [0, 0, 0, 1]);
    q.additive(
      pose("rotation", [0, 0, 1, 0]),
      pose("rotation", [0, 0, 0, 1]),
      0.5,
    );
    expect(q.values[2]).toBeCloseTo(Math.SQRT1_2);
    const w = pose("weights", [0.2]);
    w.additive(pose("weights", [0.6]), pose("weights", [0.2]), 0.5);
    expect(w.values[0]).toBeCloseTo(0.4);
  });
  it("rejects incompatible pose types/sizes and invalid blend weights", () => {
    const p = pose("translation", [0, 0, 0]);
    expect(() => p.blend(pose("scale", [1, 1, 1]), 0.5)).toThrow();
    expect(() => p.blend(p, NaN)).toThrow();
  });
});
describe("persistent crossfade playback", () => {
  const setup = () => {
    const world = new World(1),
      e = world.create();
    world.transforms.add(e);
    const morph: MorphState = {
      weightOffset: 0,
      targetCount: 1,
      weights: new Float32Array([0.2]),
      dirty: false,
    };
    const channel = (
      path: "translation" | "rotation" | "scale" | "weights",
      a: number[],
      b: number[],
    ) =>
      new AnimationChannel(
        0,
        path,
        new AnimationSampler(
          new Float32Array([0, 1]),
          new Float32Array([...a, ...b]),
          "LINEAR",
          path === "rotation",
        ),
      );
    const a = new AnimationClip("a", [
      channel("translation", [0, 0, 0], [10, 0, 0]),
      channel("rotation", [0, 0, 0, 1], [0, 0, 1, 0]),
      channel("scale", [1, 1, 1], [0.5, 0.5, 0.5]),
      channel("weights", [0], [1]),
    ]);
    const b = new AnimationClip("b", [
      channel("translation", [-10, 0, 0], [-10, 0, 0]),
      channel("rotation", [0, 0, 0, 1], [0, 0, 0, 1]),
      channel("scale", [0.25, 0.25, 0.25], [0.25, 0.25, 0.25]),
      channel("weights", [1], [1]),
    ]);
    const c = new AnimationClip("partial", [
      channel("translation", [2, 0, 0], [2, 0, 0]),
    ]);
    const animator = new Animator(
      [a, b, c],
      world,
      new Int32Array([e]),
      new Map([[e, morph]]),
    );
    animator.loop = false;
    return { world, e, morph, animator };
  };
  it("crossfades all components and completes the target clip", () => {
    const { world, e, morph, animator } = setup();
    animator.play();
    animator.crossFade(1, 1);
    animator.update(0.5);
    expect(world.transforms.positionX[e]).toBe(-2.5);
    expect(world.transforms.scaleX[e]).toBe(0.5);
    expect(world.transforms.rotationZ[e]).toBeCloseTo(Math.sin(Math.PI / 8));
    expect(morph.weights[0]).toBe(0.75);
    animator.update(0.5);
    expect(animator.crossfading).toBe(false);
    expect(animator.playing).toBe(false);
    expect(world.transforms.positionX[e]).toBe(-10);
  });
  it("pauses, seeks, interrupts smoothly and restores missing channels to rest", () => {
    const { world, e, morph, animator } = setup();
    animator.play();
    animator.crossFade(1, 1);
    animator.update(0.25);
    const before = world.transforms.positionX[e];
    animator.pause();
    animator.update(0.5);
    expect(world.transforms.positionX[e]).toBe(before);
    animator.play();
    animator.crossFade(2, 1);
    expect(world.transforms.positionX[e]).toBe(before);
    animator.update(1);
    expect(world.transforms.positionX[e]).toBe(2);
    expect(world.transforms.scaleX[e]).toBe(1);
    expect(world.transforms.rotationW[e]).toBe(1);
    expect(morph.weights[0]).toBeCloseTo(0.2);
    animator.crossFade(0, 1);
    animator.currentTime = 0.5;
    expect(animator.crossfading).toBe(false);
    expect(world.transforms.positionX[e]).toBe(5);
  });
});
