import { bench } from "vitest";
import { BatchBuilder } from "../src/rendering/BatchBuilder";
import { RenderQueue } from "../src/rendering/RenderQueue";
import { RenderWorld } from "../src/rendering/RenderWorld";
import {
  UnifiedTransparency,
  type TransparencyEffects,
} from "../src/rendering/UnifiedTransparency";

for (const pattern of [
  "meshes",
  "billboards",
  "separated",
  "alternating",
] as const) {
  const count = 10000;
  const queue = new RenderQueue(count),
    world = new RenderWorld(count),
    batches = new BatchBuilder(count);
  queue.count = world.count = pattern === "billboards" ? 0 : count;
  const effects: TransparencyEffects = {
    order: new Uint32Array(count),
    depths: new Float32Array(count),
    alphaCount: pattern === "meshes" ? 0 : count,
    trailOrder: new Uint32Array(count),
    trailDepths: new Float32Array(count),
    trailAlphaCount:
      pattern === "meshes" || pattern === "billboards" ? 0 : count,
  };
  for (let i = 0; i < count; i++) {
    queue.order[i] = effects.order[i] = effects.trailOrder[i] = i;
    queue.pipeline[i] = 12;
    queue.depth[i] =
      pattern === "alternating" ? (count - i) * 3 : count * 3 - i;
    effects.depths[i] =
      pattern === "alternating" ? (count - i) * 3 - 1 : count * 2 - i;
    effects.trailDepths[i] =
      pattern === "alternating" ? (count - i) * 3 - 2 : count - i;
  }
  batches.build(queue, world);
  const schedule = new UnifiedTransparency(count * 3);
  bench(`unified transparency 10000 ${pattern}`, () => {
    // Measure hot sorted-stream merging and run coalescing with no allocations or GPU work.
    schedule.build(queue, batches, effects);
  });
}
