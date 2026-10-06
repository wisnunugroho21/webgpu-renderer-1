import { expect, it } from "vitest";
import { halfFloatClearColor } from "../src/rendering/post/halfFloatClearColor";

it("bounds HDR clears before conversion while preserving caller data and retained storage", () => {
  // Infinity produced by half-float clear conversion cannot be reliably repaired by a later shader.
  const target = [0, 0, 0, 1];
  const color = { r: 1e6, g: -1e6, b: 0.18, a: 1 };
  expect(halfFloatClearColor(color, target)).toBe(target);
  expect([...target]).toEqual([65504, -65504, 0.18, 1]);
  expect(color.r).toBe(1e6);
  expect(halfFloatClearColor([2, 4, 16, 0.5], target)).toBe(target);
  expect([...target]).toEqual([2, 4, 16, 0.5]);
  expect(() => {
    // Keep malformed sequence rejection instead of reusing stale channels.
    halfFloatClearColor([1, 2, 3], target);
  }).toThrow("four channels");
});
