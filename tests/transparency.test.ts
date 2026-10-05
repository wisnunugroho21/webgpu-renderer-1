import { describe, expect, it } from "vitest";
import { BatchBuilder } from "../src/rendering/BatchBuilder";
import { RenderQueue } from "../src/rendering/RenderQueue";
import { RenderWorld } from "../src/rendering/RenderWorld";
import {
  UnifiedTransparency,
  type TransparencyEffects,
} from "../src/rendering/UnifiedTransparency";

/** Construct sorted streams with an opaque prefix and one instanced alpha mesh batch. */
function fixture(mesh: number[], billboard: number[], ribbon: number[]) {
  const queue = new RenderQueue(mesh.length + 1);
  const world = new RenderWorld(mesh.length + 1);
  queue.count = world.count = mesh.length + 1;
  for (let i = 0; i < queue.count; i++) {
    queue.order[i] = i;
    queue.pipeline[i] = i ? 12 : 0;
    queue.depth[i] = i ? mesh[i - 1]! : 100;
  }
  const batches = new BatchBuilder(queue.count);
  batches.build(queue, world);
  const effects: TransparencyEffects = {
    order: Uint32Array.from(
      billboard.map((_, i) => /** Construct persistent record indices. */ i),
    ),
    depths: Float32Array.from(billboard),
    alphaCount: billboard.length,
    trailOrder: Uint32Array.from(
      ribbon.map((_, i) => /** Construct persistent record indices. */ i),
    ),
    trailDepths: Float32Array.from(ribbon),
    trailAlphaCount: ribbon.length,
  };
  return { queue, batches, effects };
}

/** Expand compressed runs into source identities to compare against an independent reference sort. */
function expand(schedule: UnifiedTransparency) {
  const values: number[][] = [];
  for (let run = 0; run < schedule.count; run++)
    for (let i = 0; i < schedule.length[run]!; i++)
      values.push([schedule.kind[run]!, schedule.first[run]! + i]);
  return values;
}

describe("unified transparency", () => {
  // Verify source rank preservation and batching rather than just inspecting draw totals.
  it("splits matching mesh instances at interleaved billboard and ribbon depths", () => {
    // Every source must compose at its own depth even inside a compatible mesh batch.
    const f = fixture([10, 8, 4, 2], [9, 3], [7, 6, 5]);
    const schedule = new UnifiedTransparency(9);
    schedule.build(f.queue, f.batches, f.effects);
    expect(expand(schedule)).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [2, 0],
      [2, 1],
      [2, 2],
      [0, 2],
      [1, 1],
      [0, 3],
    ]);
    expect(schedule.count).toBe(7);
    expect(Array.from(schedule.length.subarray(0, 7))).toEqual([
      1, 1, 1, 3, 1, 1, 1,
    ]);
  });
  it("retains deterministic equal-depth precedence and excludes opaque geometry", () => {
    // Ties cannot alternate with unrelated batching state or camera frame history.
    const f = fixture([5, 5], [5, 5], [5, 5]);
    const schedule = new UnifiedTransparency(6);
    schedule.build(f.queue, f.batches, f.effects);
    expect(expand(schedule)).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
    ]);
    expect(schedule.count).toBe(3);
  });
  it("matches a stable reference across varying source sizes and depth ties", () => {
    // Integer depths deliberately introduce ties across all three independently sorted streams.
    for (let seed = 0; seed < 50; seed++) {
      const streams = [0, 1, 2].map((kind) => {
        // Generate reproducible sorted inputs without depending on production merge code.
        return Array.from(
          { length: (seed * (kind + 3)) % 21 },
          (_, i) =>
            /** Deliberately repeat depths across stream boundaries. */ (i *
              17 +
              seed * 13 +
              kind) %
            11,
        ).sort((a, b) => /** Sort each input farthest first. */ b - a);
      });
      const f = fixture(streams[0]!, streams[1]!, streams[2]!);
      const schedule = new UnifiedTransparency(63);
      schedule.build(f.queue, f.batches, f.effects);
      const reference = streams
        .flatMap((depths, kind) => {
          // Keep original rank for equal depth items of the same type.
          return depths.map(
            (
              depth,
              index,
            ) => /** Retain independent source rank in the reference. */ ({
              depth,
              kind,
              index,
            }),
          );
        })
        .sort(
          (a, b) =>
            /** Apply explicit depth, type and stable rank precedence. */ b.depth -
              a.depth ||
            a.kind - b.kind ||
            a.index - b.index,
        );
      expect(expand(schedule)).toEqual(
        reference.map((v) => {
          // Project the independent reference to the same source identity tuple.
          return [v.kind, v.index];
        }),
      );
    }
  });
  it("keeps indirect LOD candidates attached to their source queue rank", () => {
    // Candidate firstInstance addresses GPU visible records, not the original mesh queue.
    const f = fixture([10, 2], [6], []);
    const b = new BatchBuilder(4);
    b.count = 4;
    b.pipeline.fill(12);
    b.instanceCount.fill(1);
    b.queueFirst.set([1, 1, 2, 2]);
    b.firstInstance.set([100, 101, 102, 103]);
    const schedule = new UnifiedTransparency(5);
    schedule.build(f.queue, b, f.effects);
    expect(Array.from(schedule.kind.subarray(0, 5))).toEqual([0, 0, 1, 0, 0]);
    expect(Array.from(schedule.batch.subarray(0, 5))).toEqual([0, 1, 0, 2, 3]);
  });
  it("reuses storage, handles empty frames and bounds alternating runs", () => {
    // Rebuilding a frame must reset stale schedule entries without replacing staging arrays.
    const f = fixture([10, 8], [9], []);
    const schedule = new UnifiedTransparency(3),
      storage = schedule.kind;
    schedule.build(f.queue, f.batches, f.effects);
    expect(schedule.count).toBe(3);
    const empty = fixture([], [], []);
    schedule.build(empty.queue, empty.batches, empty.effects);
    expect(schedule.count).toBe(0);
    expect(schedule.kind).toBe(storage);
    expect(() =>
      /** Exercise failure when alternating runs exceed reserved capacity. */ new UnifiedTransparency(
        2,
      ).build(f.queue, f.batches, f.effects),
    ).toThrow("capacity");
  });
  it("retains a single draw when mesh or effect streams have no interleaving", () => {
    // Sorting correctness should preserve bulk instancing and contiguous particle ranges.
    const f = fixture(
      Array.from(
        { length: 10000 },
        (_, i) => /** Build descending mesh center depths. */ 10000 - i,
      ),
      [],
      [],
    );
    const schedule = new UnifiedTransparency(10000);
    schedule.build(f.queue, f.batches, f.effects);
    expect(schedule.count).toBe(1);
    expect(schedule.length[0]).toBe(10000);
  });
});
