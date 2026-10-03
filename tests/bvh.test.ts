import { describe, expect, it } from "vitest";
import { BVH } from "../src/visibility/BVH";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderFlags } from "../src/rendering/RenderFlags";
import { Frustum } from "../src/math/Frustum";
import { Mat4 } from "../src/math/Mat4";
import { FrustumCuller } from "../src/visibility/FrustumCuller";
import { RenderExtractor } from "../src/rendering/RenderExtractor";
import { World } from "../src/ecs/World";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
describe("flat static BVH", () => {
  it("matches linear visibility with mixed static/dynamic objects and moving dynamics", () => {
    const w = new RenderWorld(10000),
      f = new Frustum(),
      c = new FrustumCuller(10000),
      bvh = new BVH(10000);
    w.count = 10000;
    f.setFromMatrix(Mat4.create());
    for (let i = 0; i < w.count; i++) {
      const x = (i % 100) / 5 - 10,
        y = Math.floor(i / 100) / 5 - 10;
      w.boundsMin.set([x - 0.05, y - 0.05, 0.4], i * 3);
      w.boundsMax.set([x + 0.05, y + 0.05, 0.6], i * 3);
      w.flags[i] = i % 3 ? RenderFlags.STATIC : 0;
    }
    bvh.build(w);
    const linear = c.cull(w, f),
      hierarchical = bvh.cull(w, f, c);
    expect(hierarchical).toBe(linear);
    expect(
      Array.from(bvh.visible.subarray(0, hierarchical)).sort((a, b) => a - b),
    ).toEqual(Array.from(c.visible.subarray(0, linear)).sort((a, b) => a - b));
    w.boundsMin.set([0, 0, 0.4], 0);
    w.boundsMax.set([0.1, 0.1, 0.6], 0);
    expect(bvh.cull(w, f, c)).toBe(c.cull(w, f));
    expect(bvh.nodeCount).toBeLessThan(20000);
  });
  it("bulk accepts contained nodes, rejects outside subtrees and handles empty trees", () => {
    const w = new RenderWorld(100),
      f = new Frustum(),
      c = new FrustumCuller(100),
      bvh = new BVH(100);
    f.setFromMatrix(Mat4.create());
    bvh.build(w);
    expect(bvh.cull(w, f, c)).toBe(0);
    w.count = 100;
    w.flags.fill(RenderFlags.STATIC);
    for (let i = 0; i < 100; i++) {
      w.boundsMin.set([-0.1, -0.1, 0.4], i * 3);
      w.boundsMax.set([0.1, 0.1, 0.6], i * 3);
    }
    bvh.build(w);
    expect(bvh.cull(w, f, c)).toBe(100);
    expect(bvh.nodesTested).toBe(1);
    expect(bvh.objectsTested).toBe(0);
    f.setFromMatrix(
      Mat4.fromTRS(Mat4.create(), [-10, 0, 0], [0, 0, 0, 1], [1, 1, 1]),
    );
    expect(bvh.cull(w, f, c)).toBe(0);
    expect(bvh.nodesTested).toBe(1);
  });
  it("invalidates static snapshots for movement, membership and compaction", () => {
    const w = new World(2),
      out = new RenderWorld(2),
      extractor = new RenderExtractor(),
      system = new TransformSystem(2);
    for (let i = 0; i < 2; i++) {
      w.transforms.add(w.create());
      w.meshes.set(i, 0, 0, RenderFlags.STATIC);
      w.bounds.setSphere(i, 0, 0, 0, 1);
    }
    system.update(w.transforms);
    extractor.extract(w, out);
    const original = out.staticRevision;
    extractor.extract(w, out);
    expect(out.staticRevision).toBe(original);
    w.transforms.setPosition(1, 2, 0, 0);
    system.update(w.transforms);
    extractor.extract(w, out);
    expect(out.staticRevision).toBe(original + 1);
    w.destroy(0);
    extractor.extract(w, out);
    expect(out.staticRevision).toBe(original + 2);
  });
});
