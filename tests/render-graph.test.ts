import { describe, it, expect } from "vitest";
import { RenderGraph } from "../src/rendering/graph/RenderGraph";
describe("render graph", () => {
  it("derives resource dependencies independently of declaration order", () => {
    const calls: string[] = [],
      graph = new RenderGraph(["scene"]);
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
    expect(() => add("later", [], [])).toThrow();
  });
  it("rejects cycles and uninitialized reads before submitting GPU commands", () => {
    const graph = new RenderGraph();
    graph.add({ name: "a", reads: ["b"], writes: ["a"], execute: () => {} });
    graph.add({ name: "b", reads: ["a"], writes: ["b"], execute: () => {} });
    expect(() => graph.compile()).toThrow(/cycle/);
    expect(graph.order).toHaveLength(0);
    const invalid = new RenderGraph();
    invalid.add({
      name: "color",
      reads: ["missing"],
      writes: [],
      execute: () => {},
    });
    expect(() => invalid.compile()).toThrow(/Uninitialized/);
    expect(() => invalid.execute({} as GPUCommandEncoder, undefined)).toThrow();
  });
  it("rejects duplicate writers and unknown dependencies", () => {
    const graph = new RenderGraph();
    graph.add({ name: "a", reads: [], writes: ["depth"], execute: () => {} });
    graph.add({ name: "b", reads: [], writes: ["depth"], execute: () => {} });
    expect(() => graph.compile()).toThrow(/Multiple writers/);
    const unknown = new RenderGraph();
    unknown.add({
      name: "a",
      reads: [],
      writes: [],
      dependsOn: ["absent"],
      execute: () => {},
    });
    expect(() => unknown.compile()).toThrow(/Unknown dependency/);
  });
});
