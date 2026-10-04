import { describe, it, expect } from "vitest";
import { RenderGraph } from "../src/rendering/graph/RenderGraph";
describe("render graph", () => {
  // Groups checks for render graph.

  it("derives resource dependencies independently of declaration order", () => {
    // Verifies derives resource dependencies independently of declaration order.

    const calls: string[] = [],
      graph = new RenderGraph(["scene"]);
    /** Delegates this operation to graph.add. */
    const add = (
      name: string,
      reads: string[],
      writes: string[],
      dependsOn: string[] = [],
    ) =>
      graph.add({
        name,
        reads,
        writes,
        dependsOn,
        /** Applies calls.push to execute. */
        execute: () => {
          calls.push(name);
        },
      });
    add("color", ["shadow", "cluster"], ["output"]);
    add("shadow", ["scene"], ["shadow"]);
    add("cluster", ["scene"], ["cluster"], ["shadow"]);
    graph.compile();
    graph.execute({} as GPUCommandEncoder, undefined);
    expect(calls).toEqual(["shadow", "cluster", "color"]);
    calls.length = 0;
    graph.execute({} as GPUCommandEncoder, undefined);
    expect(calls).toEqual(["shadow", "cluster", "color"]);
    expect(() =>
      /** Delegates this operation to add. */ add("later", [], []),
    ).toThrow();
  });
  it("rejects cycles and uninitialized reads before submitting GPU commands", () => {
    // Verifies rejects cycles and uninitialized reads before submitting GPU commands.

    const graph = new RenderGraph();
    graph.add({
      name: "a",
      reads: ["b"],
      writes: ["a"],
      /** Intentionally performs no work at this optional callback boundary. */
      execute: () => {},
    });
    graph.add({
      name: "b",
      reads: ["a"],
      writes: ["b"],
      /** Intentionally performs no work at this optional callback boundary. */
      execute: () => {},
    });
    expect(() =>
      /** Delegates this operation to graph.compile. */ graph.compile(),
    ).toThrow(/cycle/);
    expect(graph.order).toHaveLength(0);
    const invalid = new RenderGraph();
    invalid.add({
      name: "color",
      reads: ["missing"],
      writes: [],
      /** Intentionally performs no work at this optional callback boundary. */
      execute: () => {},
    });
    expect(() =>
      /** Delegates this operation to invalid.compile. */ invalid.compile(),
    ).toThrow(/Uninitialized/);
    expect(() =>
      /** Delegates this operation to invalid.execute. */ invalid.execute(
        {} as GPUCommandEncoder,
        undefined,
      ),
    ).toThrow();
  });
  it("rejects duplicate writers and unknown dependencies", () => {
    // Verifies rejects duplicate writers and unknown dependencies.

    const graph = new RenderGraph();
    graph.add({
      name: "a",
      reads: [],
      writes: ["depth"],
      /** Intentionally performs no work at this optional callback boundary. */
      execute: () => {},
    });
    graph.add({
      name: "b",
      reads: [],
      writes: ["depth"],
      /** Intentionally performs no work at this optional callback boundary. */
      execute: () => {},
    });
    expect(() =>
      /** Delegates this operation to graph.compile. */ graph.compile(),
    ).toThrow(/Multiple writers/);
    const unknown = new RenderGraph();
    unknown.add({
      name: "a",
      reads: [],
      writes: [],
      dependsOn: ["absent"],
      /** Intentionally performs no work at this optional callback boundary. */
      execute: () => {},
    });
    expect(() =>
      /** Delegates this operation to unknown.compile. */ unknown.compile(),
    ).toThrow(/Unknown dependency/);
  });
});
