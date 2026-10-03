import { describe, it, expect } from "vitest";
import { MorphStatePool } from "../src/animation/MorphStatePool";
import { MorphTargetData } from "../src/animation/MorphTargetData";
describe("shared morph data", () => {
  it("allocates independent contiguous ranges and accepts negative weights", () => {
    const p = new MorphStatePool(5),
      a = p.create(2, [0.2, -0.3]),
      b = p.create(2, [0.7, 0.8]);
    expect(p.states[a]!.weightOffset).toBe(0);
    expect(p.states[b]!.weightOffset).toBe(2);
    expect(p.states[a]!.weights.buffer).toBe(p.data.buffer);
    p.states[a]!.weights[0] = 1;
    expect(p.states[b]!.weights[0]).toBeCloseTo(0.7);
    expect(p.count).toBe(4);
    expect(() => p.create(2)).toThrow("capacity");
  });
  it("rejects default weight length/nonfinite values without consuming capacity", () => {
    const p = new MorphStatePool(4);
    expect(() => p.create(2, [1])).toThrow();
    expect(() => p.create(2, [NaN, 1])).toThrow();
    expect(p.count).toBe(0);
  });
  it("retains position, normal and three-component tangent deltas", () => {
    const targets = [
        {
          POSITION: new Float32Array(9),
          NORMAL: new Float32Array(9),
          TANGENT: new Float32Array(9),
        },
      ],
      m = new MorphTargetData(targets, 3);
    expect(m.targets).toBe(targets);
    expect(m.targetCount).toBe(1);
    expect(m.vertexCount).toBe(3);
    expect(
      () => new MorphTargetData([{ POSITION: new Float32Array(8) }], 3),
    ).toThrow();
    expect(
      () => new MorphTargetData([{ TANGENT: new Float32Array(12) }], 3),
    ).toThrow();
    expect(
      () =>
        new MorphTargetData([{ POSITION: new Float32Array([NaN, 0, 0]) }], 1),
    ).toThrow();
  });
});
