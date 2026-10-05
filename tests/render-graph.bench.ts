import { bench } from "vitest";
import { RenderGraph } from "../src/rendering/graph/RenderGraph";
/** Construct a chain of transient versions to measure cold compilation and coloring. */
function graph(count: number): RenderGraph {
  const result = new RenderGraph();
  for (let i = 0; i < count; i++) {
    result.transient(`target${i}`, {
      descriptor: { size: [256, 256], format: "rgba16float", usage: 20 },
      initialization: "clear",
    });
    result.add({
      name: `pass${i}`,
      reads: i ? [`target${i - 1}`] : [],
      writes: [`target${i}`],
      execute: () => {
        // Stable empty callback isolates graph dispatch cost from GPU work.
      },
    });
  }
  result.compile();
  return result;
}
bench("compile/color 100 transient graph targets", () => {
  // Compilation includes dependency sorting, inclusive intervals and compatible slot assignment.
  graph(100);
});
const compiled = graph(100),
  encoder = {} as GPUCommandEncoder;
bench("execute 100 compiled passes 1000 times", () => {
  // Ordinary execution must reuse schedule/targets without replanning or GPU resource creation.
  for (let i = 0; i < 1000; i++) compiled.execute(encoder, undefined);
});

const legacyGraph = new RenderGraph(),
  counter = { calls: 0 };
for (let i = 0; i < 8; i++)
  legacyGraph.add({
    name: `pass${i}`,
    reads: i ? [`resource${i - 1}`] : [],
    writes: [`resource${i}`],
    execute: () => {
      // Preserve the original dispatch workload for comparisons across graph revisions.
      counter.calls++;
    },
  });
legacyGraph.compile();
bench("execute eight compiled passes 10,000 times", () => {
  // Original callback arithmetic remains unchanged by cold lifetime analysis.
  for (let i = 0; i < 10000; i++) legacyGraph.execute(encoder, undefined);
});
