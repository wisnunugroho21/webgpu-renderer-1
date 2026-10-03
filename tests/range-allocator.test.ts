import { expect, it } from "vitest";
import { RangeAllocator } from "../src/assets/RangeAllocator";
it("coalesces holes, preserves live ranges, trims the tail and rejects exhausted/invalid requests", () => {
  const arena = new RangeAllocator(10),
    a = arena.allocate(3),
    b = arena.allocate(3),
    c = arena.allocate(4);
  expect([a, b, c]).toEqual([0, 3, 6]);
  expect(() => arena.allocate(1)).toThrow("capacity");
  arena.release(a);
  arena.release(b);
  expect(arena.allocate(5)).toBe(0);
  expect(arena.count).toBe(10);
  arena.release(c);
  expect(arena.count).toBe(5);
  arena.release(0);
  arena.release(0);
  expect(arena.count).toBe(0);
  expect(() => arena.allocate(0)).toThrow("Invalid");
  expect(() => arena.allocate(1.5)).toThrow("Invalid");
});
