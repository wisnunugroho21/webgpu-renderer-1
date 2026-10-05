import { expect, it } from "vitest";
import { ParticleDepthSorter } from "../src/rendering/particles/ParticleDepthSorter";
it("orders signed depths stably, preserving ties, the used prefix and backing-array identity", () => {
  // Compare fixed scratch sorting against numeric reference order, including camera-behind and zero-depth cases.
  const depths = new Float32Array(1000);
  let seed = 1;
  for (let i = 0; i < depths.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    depths[i] = ((seed % 1000) - 500) / 3;
  }
  depths[0] = -0;
  depths[1] = 0;
  depths[2] = depths[3] = 50;
  const sorter = new ParticleDepthSorter(depths),
    order = Uint32Array.from(
      { length: 1000 },
      (_, i) => /** Seed deterministic pool-index order. */ i,
    );
  const buffer = order.buffer;
  const reference = Array.from(order).sort(
    (a, b) =>
      /** Numeric far-to-near reference with pool-index ties. */ depths[b]! -
        depths[a]! || a - b,
  );
  sorter.sort(order, order.length);
  expect(Array.from(order)).toEqual(reference);
  expect(order.buffer).toBe(buffer);
  order.set([0, 3, 1, 2, 99]);
  sorter.sort(order, 4);
  expect(Array.from(order.slice(0, 5))).toEqual([3, 2, 0, 1, 99]);
});
