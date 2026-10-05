import { expect, it } from "vitest";
import { RenderGraph } from "../src/rendering/graph/RenderGraph";
import {
  TransientTargetPool,
  targetDescriptor,
} from "../src/gpu/TransientTargetPool";
import { TextureManager } from "../src/gpu/TextureManager";
import { ResourceStats } from "../src/gpu/ResourceStats";
const descriptor: GPUTextureDescriptor = {
  size: [8, 8],
  format: "rgba16float",
  usage: 20,
};
/** Controlled device and completion fence keep unit tests independent of a real GPU. */
function pool(maxBytes = 4096, maxTargets = 8) {
  const stats = new ResourceStats();
  let creates = 0,
    destroys = 0;
  const device = {
    createTexture: () => {
      // Count real physical allocations and return stable mock view identity.
      creates++;
      return {
        createView: () => {
          // One retained view is created for each pool entry.
          return {};
        },
        destroy: () => {
          // Observe ownership destruction, including rollback and idle eviction.
          destroys++;
        },
      };
    },
  } as unknown as GPUDevice;
  let complete: () => void = () => {
    // Initial fence is already completed unless a test replaces it.
  };
  const manager = new TextureManager(device, stats),
    p = new TransientTargetPool(
      manager,
      () => {
        // Hold release quarantine until the test explicitly completes submitted work.
        return new Promise<void>((resolve) => {
          // Retain the resolver until the simulated GPU queue completes.
          complete = resolve;
        });
      },
      maxBytes,
      maxTargets,
    );
  return {
    p,
    stats,
    finish: () => {
      // Simulate one completed cold GPU fence.
      complete();
    },
    counts: () => {
      // Report cumulative mock GPU object creation/destruction.
      return { creates, destroys };
    },
  };
}
/** Add a side-effect-free pass with explicit ordering for lifetime fixtures. */
function pass(
  graph: RenderGraph,
  name: string,
  reads: string[],
  writes: string[],
  dependsOn: string[] = [],
) {
  graph.add({
    name,
    reads,
    writes,
    dependsOn,
    execute: () => {
      // No GPU work is needed to verify dependency and interval analysis.
    },
  });
}
it("colors compatible nonoverlapping lifetimes and keeps same-pass/exports live", () => {
  // First/last use comes from compiled execution order, not pass declaration order.
  const graph = new RenderGraph(["input"]);
  pass(graph, "consume-a", ["a"], []);
  pass(graph, "write-a", ["input"], ["a"]);
  pass(graph, "write-b", [], ["b"], ["consume-a"]);
  pass(graph, "read-b", ["b"], ["c"]);
  pass(graph, "write-d", [], ["d"], ["read-b"]);
  for (const name of ["a", "b", "c", "d"])
    graph.transient(name, {
      descriptor,
      initialization: "clear",
      exported: name === "c",
    });
  graph.compile();
  expect(graph.lifetimes.get("a")).toMatchObject({ first: 0, last: 1 });
  expect(graph.lifetimes.get("input")).toMatchObject({
    first: -1,
    imported: true,
  });
  expect(graph.targets.slots).toHaveLength(2);
  expect(graph.targets.logicalBytes).toBe(2048);
  expect(graph.targets.physicalBytes).toBe(1024);
  expect(graph.targets.peakLiveBytes).toBe(1024);
  expect(graph.targets.slots[0]?.resources).toEqual(["a", "b", "d"]);
  expect(graph.lifetimes.get("c")?.last).toBe(graph.order.length);
});
it("rejects undeclared producers and load-first targets transactionally", () => {
  // A pooled target cannot inherit initialized contents from a previous logical owner.
  const graph = new RenderGraph();
  graph.transient("missing", { descriptor, initialization: "clear" });
  expect(() =>
    /** Compile a target with no producer to verify transactional rejection. */ graph.compile(),
  ).toThrow("producer");
  expect(graph.order).toHaveLength(0);
  expect(graph.lifetimes.size).toBe(0);
  expect(() =>
    /** Reject a target that attempts to load pooled contents on its first write. */ graph.transient(
      "load",
      { descriptor, initialization: "load" as "clear" },
    ),
  ).toThrow("initialize");
});
it("normalizes defaults but isolates incompatible descriptors", () => {
  // Labels and view-format ordering do not affect compatibility; all allocation/usage fields do.
  expect(targetDescriptor(descriptor).key).toBe(
    targetDescriptor({
      ...descriptor,
      label: "other",
      size: { width: 8, height: 8 },
      sampleCount: 1,
      mipLevelCount: 1,
      dimension: "2d",
    }).key,
  );
  for (const modified of [
    { size: [9, 8] },
    { format: "rgba8unorm" },
    { usage: 4 },
    { mipLevelCount: 2 },
    { sampleCount: 4 },
    { dimension: "3d" },
    { viewFormats: ["rgba16float"] },
  ] as Partial<GPUTextureDescriptor>[])
    expect(targetDescriptor({ ...descriptor, ...modified }).key).not.toBe(
      targetDescriptor(descriptor).key,
    );
  expect(() =>
    /** Reject an empty physical extent before allocation. */ targetDescriptor({
      ...descriptor,
      size: [0, 8],
    }),
  ).toThrow();
});
it("reuses completed leases, quarantines pending work, and releases aliases once", async () => {
  // Pending leases cannot be acquired again until their fence completes.
  const f = pool(),
    first = f.p.acquire(descriptor);
  first.release();
  await Promise.resolve();
  const second = f.p.acquire(descriptor);
  expect(second.texture).not.toBe(first.texture);
  expect(f.p.stats.retiredBytes).toBe(512);
  f.finish();
  await f.p.settle();
  const reused = f.p.acquire({ ...descriptor, label: "reuse" });
  expect(reused.texture).toBe(first.texture);
  first.release();
  expect(f.p.stats.activeBytes).toBe(1024);
  expect(f.p.stats.hits).toBe(1);
  f.p.dispose();
  expect(f.counts()).toEqual({ creates: 2, destroys: 2 });
  expect(f.stats.textureBytes).toBe(0);
});
it("bounds idle retention and cannot resurrect disposed ownership", async () => {
  // Completed idle targets over budget are destroyed rather than retained forever.
  const f = pool(0, 0),
    lease = f.p.acquire(descriptor);
  lease.release();
  await Promise.resolve();
  f.finish();
  await f.p.settle();
  expect(f.p.stats.evictions).toBe(1);
  expect(f.stats.textures).toBe(0);
  const next = f.p.acquire(descriptor);
  next.release();
  await Promise.resolve();
  f.p.dispose();
  f.finish();
  await f.p.settle();
  expect(f.p.stats.idleBytes).toBe(0);
  expect(f.counts().destroys).toBe(2);
});
it("prepares one physical lease for graph aliases and retains views across executions", () => {
  // Graph execution has no acquisition or GPU creation path.
  const graph = new RenderGraph();
  pass(graph, "a", [], ["a"]);
  pass(graph, "b", [], ["b"], ["a"]);
  graph.transient("a", { descriptor, initialization: "clear" });
  graph.transient("b", { descriptor, initialization: "full-write" });
  graph.compile();
  const f = pool(),
    targets = graph.prepareTargets(f.p);
  expect("release" in targets.get("a")).toBe(false);
  expect(targets.get("a").texture).toBe(targets.get("b").texture);
  for (let i = 0; i < 5; i++) graph.execute({} as GPUCommandEncoder, undefined);
  expect(f.counts().creates).toBe(1);
  targets.dispose();
  targets.dispose();
  expect(f.p.stats.retiredBytes).toBe(512);
  f.p.dispose();
});

it("rolls back partially acquired plans and snapshots authoring inputs", async () => {
  // A failed preparation never leaks active leases; compile uses copied authoring descriptors/passes.
  const graph = new RenderGraph(),
    size = [8, 8],
    reads: string[] = [],
    writes = ["a"];
  graph.transient("a", {
    descriptor: { ...descriptor, size },
    initialization: "clear",
  });
  graph.transient("b", {
    descriptor: { ...descriptor, size: [16, 16] },
    initialization: "clear",
  });
  pass(graph, "a", reads, writes);
  pass(graph, "b", [], ["b"], ["a"]);
  size[0] = 64;
  writes[0] = "mutated";
  reads.push("unknown");
  graph.compile();
  expect(graph.targets.logicalBytes).toBe(512 + 2048);
  const f = pool(),
    acquire = f.p.acquire.bind(f.p);
  let calls = 0;
  f.p.acquire = (desc) => {
    // Simulate a cold GPU allocation failure after one physical target was leased.
    if (++calls === 2) throw new Error("allocation failed");
    return acquire(desc);
  };
  expect(() => {
    // Trigger preparation rollback instead of publishing a partially usable target set.
    graph.prepareTargets(f.p);
  }).toThrow("allocation failed");
  expect(f.p.stats.activeBytes).toBe(0);
  await Promise.resolve();
  f.finish();
  await f.p.settle();
  expect(f.p.stats.idleBytes).toBe(512);
  f.p.clearIdle();
  expect(f.stats.textures).toBe(0);
  f.p.dispose();
});
it("destroys quarantine when the completion fence rejects", async () => {
  // A lost-device fence must never publish an old target into the reusable cache.
  const stats = new ResourceStats();
  let destroys = 0;
  const manager = new TextureManager(
      {
        createTexture: () => {
          // This fixture records destruction of the rejected retired texture.
          return {
            createView: () => {
              // Supply a stable mock default view.
              return {};
            },
            destroy: () => {
              // Count the single cleanup despite repeated disposal.
              destroys++;
            },
          };
        },
      } as unknown as GPUDevice,
      stats,
    ),
    p = new TransientTargetPool(manager, async () => {
      // Emulate device loss at the explicit retirement boundary.
      throw new Error("lost");
    });
  p.acquire(descriptor).release();
  await p.settle();
  expect(stats.textures).toBe(0);
  expect(p.stats.idleBytes).toBe(0);
  expect(p.stats.retiredBytes).toBe(0);
  p.dispose();
  expect(destroys).toBe(1);
});
