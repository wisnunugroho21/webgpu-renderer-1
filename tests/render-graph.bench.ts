import { bench, describe } from "vitest";
import { RenderGraph } from "../src/rendering/graph/RenderGraph";
const graph = new RenderGraph();
const counter = { calls: 0 };
for (let i = 0; i < 8; i++)
  graph.add({
    name: `pass${i}`,
    reads: i ? [`resource${i - 1}`] : [],
    writes: [`resource${i}`],
    /** Provides the controlled callback used by render-graph.bench.ts. */
    execute: () => {
      counter.calls++;
    },
  });
graph.compile();
const encoder = {} as GPUCommandEncoder;
describe("render graph", () => {
  // Groups checks for render graph.

  bench("execute eight compiled passes 10,000 times", () => {
    // Measures execute eight compiled passes 10,000 times.

    for (let i = 0; i < 10000; i++) graph.execute(encoder, undefined);
  });
});
