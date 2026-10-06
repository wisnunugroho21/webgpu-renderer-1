import { describe, it, expect } from "vitest";
import { compareBenchmarks } from "../scripts/compare-benchmarks.mjs";

describe("default rendering regression comparison", () => {
  // Allow only explicitly documented cold optical overhead, never work or disposal regressions.
  const before = {
    scene: {
      stats: { drawCalls: 1, bufferUploadBytes: 32 },
      resourcesBefore: { textures: 5, textureBytes: 8, bufferBytes: 100 },
    },
  };
  const after = {
    scene: {
      stats: { drawCalls: 1, bufferUploadBytes: 32, temporalDrawCalls: 0 },
      resourcesBefore: { textures: 6, textureBytes: 16, bufferBytes: 196708 },
    },
  };
  it("accepts the exact shared optical material/fallback costs", () => {
    // Cold material capacity growth is allowed independently of frame upload bytes.
    expect(compareBenchmarks(before, after).compared).toBe(5);
  });
  it("rejects extra allocations, uploads, draws and enabled optional work", () => {
    // An allowlist cannot mask an additional texture or a per-frame regression.
    for (const mutate of [
      (r) => {
        /* Simulate an unexpected additional target. */ r.scene.resourcesBefore
          .textures++;
      },
      (r) => {
        /* Simulate a larger dirty upload. */ r.scene.stats.bufferUploadBytes++;
      },
      (r) => {
        /* Simulate a broken batch. */ r.scene.stats.drawCalls++;
      },
      (r) => {
        /* Simulate accidentally enabled TAA. */ r.scene.stats
          .temporalDrawCalls++;
      },
    ]) {
      const result = structuredClone(after);
      mutate(result);
      expect(() => {
        /* Apply the strict comparator to each independent regression. */ compareBenchmarks(
          before,
          result,
        );
      }).toThrow();
    }
  });
});
