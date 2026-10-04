import { describe, expect, it } from "vitest";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderQueue } from "../src/rendering/RenderQueue";
import { RenderSorter } from "../src/rendering/RenderSorter";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { Mat4 } from "../src/math/Mat4";
describe("render queues", () => {
  // Groups checks for render queues.

  it("partitions opaque/mask/transparent and sorts transparency by view depth", () => {
    // Verifies partitions opaque/mask/transparent and sorts transparency by view depth.

    const w = new RenderWorld(5),
      m = new MaterialManager(3),
      q = new RenderQueue(5);
    m.create();
    m.create({ alphaMode: "MASK" });
    m.create({ alphaMode: "BLEND" });
    w.count = 5;
    w.materialId.set([2, 0, 2, 1, 2]);
    w.sphere[2] = -5;
    w.sphere[10] = -20;
    w.sphere[18] = -10;
    q.build(w, m, Mat4.create());
    new RenderSorter().sort(q, w);
    expect([q.opaqueCount, q.maskCount, q.transparentCount]).toEqual([1, 1, 3]);
    expect(Array.from(q.order)).toEqual([1, 3, 2, 4, 0]);
  });
  it("sorts opaque state before depth and accepts a visible subset", () => {
    // Verifies sorts opaque state before depth and accepts a visible subset.

    const w = new RenderWorld(4),
      m = new MaterialManager(3),
      q = new RenderQueue(4);
    m.create();
    m.create();
    m.create({ doubleSided: true });
    w.count = 4;
    w.materialId.set([1, 0, 1, 2]);
    w.meshId.set([1, 2, 0, 0]);
    q.build(w, m, Mat4.create(), new Uint32Array([0, 2, 3]), 3);
    new RenderSorter().sort(q, w);
    expect(Array.from(q.order.subarray(0, q.count))).toEqual([2, 0, 3]);
  });
  for (const materials of [1, 100, 1000])
    it(`reduces 10,000 interleaved objects to ${materials} material runs`, () => {
      // Verifies render queues.

      const w = new RenderWorld(10000),
        m = new MaterialManager(materials),
        q = new RenderQueue(10000);
      for (let i = 0; i < materials; i++) m.create();
      w.count = 10000;
      for (let i = 0; i < w.count; i++) w.materialId[i] = i % materials;
      q.build(w, m, Mat4.create());
      new RenderSorter().sort(q, w);
      let switches = 0,
        previous = -1;
      for (let i = 0; i < q.count; i++) {
        const id = w.materialId[q.order[i]!]!;
        if (id !== previous) {
          switches++;
          previous = id;
        }
      }
      expect(switches).toBe(materials);
    });
});
