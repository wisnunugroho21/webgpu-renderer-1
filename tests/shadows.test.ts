import { ShadowSceneCache } from "../src/rendering/shadows/ShadowSceneCache";
import { cascadeSplit } from "../src/rendering/shadows/CascadeSplits";
import { describe, it, expect } from "vitest";
import { Mat4 } from "../src/math/Mat4";
import { Camera } from "../src/rendering/Camera";
import { ShadowCamera } from "../src/rendering/shadows/ShadowCamera";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { LightStore } from "../src/ecs/components/LightStore";
describe("directional shadows", () => {
  // Groups checks for directional shadows.

  it("invalidates cached depth on geometry, palette, weights, materials and membership changes", () => {
    // Verifies invalidates cached depth on geometry, palette, weights, materials and membership changes.

    const world = new RenderWorld(2),
      records = new Uint32Array(24),
      cache = new ShadowSceneCache(world);
    world.count = 1;
    world.jointCount = 1;
    world.morphWeightCount = 1;
    expect(cache.update(world, records, 1, 0)).toBe(true);
    expect(cache.update(world, records, 1, 0)).toBe(false);
    world.matrices[0] = 0.5;
    expect(cache.update(world, records, 1, 0)).toBe(true);
    expect(cache.update(world, records, 1, 0)).toBe(false);
    world.jointMatrices[12] = 2;
    expect(cache.update(world, records, 1, 0)).toBe(true);
    world.morphWeights[0] = -0.25;
    expect(cache.update(world, records, 1, 0)).toBe(true);
    records[8] = 16;
    expect(cache.update(world, records, 1, 0)).toBe(true);
    expect(cache.update(world, records, 1, 1)).toBe(true);
    world.count = 0;
    expect(cache.update(world, records, 0, 1)).toBe(true);
    expect(cache.update(world, records, 0, 1)).toBe(false);
  });
  it("splits logarithmic/uniform cascades into contiguous increasing ranges", () => {
    // Verifies splits logarithmic/uniform cascades into contiguous increasing ranges.

    let previous = 0.1;
    for (let count = 1; count <= 4; count++)
      for (let index = 1; index <= count; index++) {
        const split = cascadeSplit(0.1, 30, index, count);
        if (index === 1) previous = 0.1;
        expect(split).toBeGreaterThan(previous);
        expect(split).toBeLessThanOrEqual(30);
        previous = split;
        if (index === count) expect(split).toBe(30);
      }
    expect(cascadeSplit(0.1, 30, 2, 4, 0)).toBeCloseTo(15.05);
    expect(cascadeSplit(0.1, 30, 2, 4, 1)).toBeCloseTo(Math.sqrt(3));
    expect(() =>
      /** Delegates this operation to cascadeSplit. */ cascadeSplit(
        0.1,
        30,
        0,
        4,
      ),
    ).toThrow();
  });
  it("uses right-handed WebGPU orthographic depth", () => {
    // Verifies uses right-handed WebGPU orthographic depth.

    const m = Mat4.create(),
      p = new Float32Array(3);
    Mat4.orthographic(m, -2, 2, -1, 1, 1, 11);
    Mat4.transformPoint(p, m, [2, 1, -1]);
    expect(Array.from(p)).toEqual([1, 1, 0]);
    Mat4.transformPoint(p, m, [-2, -1, -11]);
    expect(Array.from(p)).toEqual([-1, -1, 1]);
    expect(() =>
      /** Delegates this operation to Mat4.orthographic. */ Mat4.orthographic(
        m,
        1,
        -1,
        0,
        1,
        0,
        1,
      ),
    ).toThrow();
  });
  it("fits receiver corners and upstream caster depths conservatively", () => {
    // Verifies fits receiver corners and upstream caster depths conservatively.

    const camera = new Camera();
    camera.setPosition(0, 0, 5);
    camera.update(4 / 3);
    const world = new RenderWorld(2);
    world.count = 2;
    world.lightData.set([0, 0, 0, 0, 1, 1, 1, 3, 0, -1, 0, 0]);
    world.boundsMin.set([-1, 100, -1, -1, -100, -1]);
    world.boundsMax.set([1, 102, 1, 1, -98, 1]);
    const shadow = new ShadowCamera();
    shadow.fit(camera, world, 0, 0.1, 30, 1024);
    const p = new Float32Array(3);
    for (const y of [-100, 102]) {
      Mat4.transformPoint(p, shadow.matrix, [0, y, 0]);
      expect(p[2]).toBeGreaterThanOrEqual(0);
      expect(p[2]).toBeLessThanOrEqual(1);
    }
    const first = shadow.matrix.slice();
    shadow.fit(camera, world, 0, 0.1, 30, 1024);
    expect(shadow.matrix).toEqual(first);
    const inverse = Mat4.create();
    Mat4.invert(inverse, camera.view);
    for (const depth of [0.1, 30])
      for (const x of [-1, 1])
        for (const y of [-1, 1]) {
          Mat4.transformPoint(p, inverse, [
            (x * depth) / camera.projection[0]!,
            (y * depth) / camera.projection[5]!,
            -depth,
          ]);
          Mat4.transformPoint(p, shadow.matrix, p);
          expect(Math.abs(p[0]!)).toBeLessThanOrEqual(1.002);
          expect(Math.abs(p[1]!)).toBeLessThanOrEqual(1.002);
          expect(p[2]).toBeGreaterThanOrEqual(0);
          expect(p[2]).toBeLessThanOrEqual(1);
        }
  });
  it("rejects unsupported shadow light types transactionally", () => {
    // Verifies rejects unsupported shadow light types transactionally.

    const lights = new LightStore(2);
    lights.set(0, { type: "directional", castShadow: true });
    expect(lights.castShadow[0]).toBe(1);
    expect(() =>
      /** Delegates this operation to lights.set. */ lights.set(0, {
        type: "point",
        castShadow: true,
      }),
    ).toThrow();
    expect(lights.type[0]).toBe(0);
    expect(lights.castShadow[0]).toBe(1);
  });
});
