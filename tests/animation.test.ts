import { Quat } from "../src/math/Quat";
import { describe, it, expect } from "vitest";
import { AnimationSampler } from "../src/animation/AnimationSampler";
import { AnimationChannel } from "../src/animation/AnimationChannel";
import { AnimationClip } from "../src/animation/AnimationClip";
import { Animator, MorphState } from "../src/animation/Animator";
import { World } from "../src/ecs/World";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
const sampler = (
  input: number[],
  output: number[],
  mode: "STEP" | "LINEAR" | "CUBICSPLINE" = "LINEAR",
  rotation = false,
) =>
  new AnimationSampler(
    new Float32Array(input),
    new Float32Array(output),
    mode,
    rotation,
  );
describe("animation sampling", () => {
  it("clamps endpoints, handles exact keys and STEP discontinuities", () => {
    const step = sampler([1, 2, 3], [10, 20, 30], "STEP"),
      out = new Float32Array(1);
    for (const [t, value] of [
      [0, 10],
      [1.5, 10],
      [2, 20],
      [2.99, 20],
      [3, 30],
      [10, 30],
    ]) {
      step.sample(t!, out);
      expect(out[0]).toBe(value);
    }
    sampler([2], [7]).sample(99, out);
    expect(out[0]).toBe(7);
    sampler([0, 2], [0, 10]).sample(0.5, out);
    expect(out[0]).toBe(2.5);
  });
  it("scales Hermite tangents by the key interval", () => {
    // f(t)=t on [0,2], with unit in/out derivatives.
    const s = sampler([0, 2], [1, 0, 1, 1, 2, 1], "CUBICSPLINE"),
      out = new Float32Array(1);
    s.sample(0.5, out);
    expect(out[0]).toBeCloseTo(0.5);
    s.sample(1.5, out);
    expect(out[0]).toBeCloseTo(1.5);
  });
  it("uses shortest-path quaternion SLERP and normalizes cubic rotations", () => {
    const out = new Float32Array(4);
    sampler([0, 1], [0, 0, 0, 1, 0, 0, 0, -1], "LINEAR", true).sample(0.5, out);
    expect(Math.abs(out[3]!)).toBeCloseTo(1);
    sampler([0, 1], [0, 0, 0, 1, 0, 0, 1, 0], "LINEAR", true).sample(0.5, out);
    expect(out[2]).toBeCloseTo(Math.SQRT1_2);
    expect(out[3]).toBeCloseTo(Math.SQRT1_2);
    sampler(
      [0, 1],
      [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      "CUBICSPLINE",
      true,
    ).sample(0.5, out);
    expect(Math.hypot(...out)).toBeCloseTo(1);
  });
  it("rejects malformed key times, output sizes and duplicate channels", () => {
    expect(() => sampler([1, 1], [0, 1])).toThrow();
    expect(() => sampler([0, NaN], [0, 1])).toThrow();
    expect(() => sampler([0, 1], [1, 2, 3])).toThrow();
    expect(
      () => new AnimationChannel(0, "translation", sampler([0, 1], [0, 1])),
    ).toThrow();
    const c = new AnimationChannel(0, "weights", sampler([0], [1]));
    expect(() => new AnimationClip("bad", [c, c])).toThrow();
  });
});
describe("animator ECS playback", () => {
  const setup = () => {
    const w = new World(4),
      e = w.create(),
      child = w.create();
    w.transforms.add(e);
    w.transforms.add(child);
    w.transforms.setParent(child, e);
    const morph: MorphState = {
      weightOffset: 0,
      targetCount: 2,
      weights: new Float32Array(2),
      dirty: false,
    };
    const clip = new AnimationClip("motion", [
      new AnimationChannel(
        0,
        "translation",
        sampler([0, 2], [0, 0, 0, 2, 4, 6]),
      ),
      new AnimationChannel(0, "scale", sampler([0, 2], [1, 1, 1, 3, 3, 3])),
      new AnimationChannel(
        0,
        "rotation",
        sampler([0, 2], [0, 0, 0, 1, 0, 0, 1, 0], "LINEAR", true),
      ),
      new AnimationChannel(0, "weights", sampler([0, 2], [0, 1, 1, 0])),
    ]);
    const a = new Animator(
      [clip],
      w,
      new Int32Array([e]),
      new Map([[e, morph]]),
    );
    return { w, e, child, morph, a, clip };
  };
  it("samples TRS/morph state, propagates hierarchy and preserves scratch", () => {
    const { w, e, child, morph, a } = setup(),
      sys = new TransformSystem(4);
    sys.update(w.transforms);
    a.play();
    a.update(1);
    sys.update(w.transforms);
    expect(w.transforms.positionX[e]).toBe(1);
    expect(w.transforms.scaleX[e]).toBe(2);
    expect(w.transforms.rotationZ[e]).toBeCloseTo(Math.SQRT1_2);
    expect(morph.weights).toEqual(new Float32Array([0.5, 0.5]));
    expect(morph.dirty).toBe(true);
    expect(w.transforms.worldMatrices[child * 16 + 12]).toBe(1);
    a.pause();
    sys.update(w.transforms);
    a.update(10);
    expect(a.currentTime).toBe(1);
    expect(w.transforms.dirtyCount).toBe(0);
  });
  it("supports seek, stop, loop, negative speed and non-looping endpoints", () => {
    const { a } = setup();
    a.play();
    a.update(5);
    expect(a.currentTime).toBe(1);
    a.pause();
    a.currentTime = 0.5;
    expect(a.currentTime).toBe(0.5);
    a.speed = -1;
    a.play();
    a.update(1);
    expect(a.currentTime).toBe(1.5);
    a.loop = false;
    a.update(10);
    expect(a.currentTime).toBe(0);
    expect(a.playing).toBe(false);
    a.speed = 2;
    a.play();
    a.update(2);
    expect(a.currentTime).toBe(2);
    expect(a.playing).toBe(false);
    a.stop();
    expect(a.currentTime).toBe(0);
    expect(a.playing).toBe(false);
    expect(() => {
      a.currentTime = NaN;
    }).toThrow();
  });
  it("keeps instances independent and ignores destroyed targets", () => {
    const { a, clip, w, e } = setup(),
      b = new Animator([clip], w, new Int32Array([-1]), new Map());
    a.play();
    b.play();
    a.update(0.25);
    b.update(1);
    expect(a.currentTime).toBe(0.25);
    expect(b.currentTime).toBe(1);
    w.destroy(e);
    expect(() => a.update(0.1)).not.toThrow();
  });
});

describe("shared normalized quaternion keys", () => {
  it("matches uncached sampling for arbitrary signs, lengths, endpoints and seeks", () => {
    const times = new Float32Array([0, 0.2, 0.7, 1.5]);
    const keys = new Float32Array([
      0, 0, 0, 2, 0, 0, 0, -3, 1e30, -2e30, 3e30, 4e30, 0, 0, 0, 0,
    ]);
    const saved = keys.slice();
    const sampled = new AnimationSampler(times, keys, "LINEAR", true);
    const actual = new Float32Array(4),
      expected = new Float32Array(4);
    const a = new Float32Array(4),
      b = new Float32Array(4);
    // Reverse and discontinuous queries exercise shared data without a playback cursor.
    for (const time of [0.4, 1.2, -1, 1.5, 0.1, 0.7, 0.2, 2, 0.6]) {
      let lo = 0,
        hi = times.length - 1;
      if (time <= times[0]!) hi = lo;
      else if (time >= times[hi]!) lo = hi;
      else
        while (hi - lo > 1) {
          const mid = (lo + hi) >>> 1;
          if (times[mid]! <= time) lo = mid;
          else hi = mid;
        }
      if (lo === hi) expected.set(keys.subarray(lo * 4, lo * 4 + 4));
      else {
        a.set(keys.subarray(lo * 4, lo * 4 + 4));
        b.set(keys.subarray(hi * 4, hi * 4 + 4));
        Quat.normalize(a, a);
        Quat.normalize(b, b);
        Quat.slerp(
          expected,
          a,
          b,
          (time - times[lo]!) / (times[hi]! - times[lo]!),
        );
      }
      Quat.normalize(expected, expected);
      sampled.sample(time, actual);
      expect(actual).toEqual(expected);
    }
    expect(keys).toEqual(saved);
  });
});
