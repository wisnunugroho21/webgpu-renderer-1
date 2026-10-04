import { describe, expect, it } from "vitest";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderQueue } from "../src/rendering/RenderQueue";
import { BatchBuilder } from "../src/rendering/BatchBuilder";
import { InstanceManager } from "../src/rendering/InstanceManager";
describe("instance batches", () => {
  // Groups checks for instance batches.

  it("reduces 10,000 matching objects to one draw without changing instance identity", () => {
    // Verifies reduces 10,000 matching objects to one draw without changing instance identity.

    const w = new RenderWorld(10000),
      q = new RenderQueue(10000),
      b = new BatchBuilder(10000),
      instances = new InstanceManager(10000);
    w.count = q.count = 10000;
    for (let i = 0; i < 10000; i++) {
      q.order[i] = 9999 - i;
      w.transformIndex[i] = i;
      w.entityId[i] = i + 50;
    }
    b.build(q, w);
    expect(b.count).toBe(1);
    expect(b.instanceCount[0]).toBe(10000);
    expect(b.firstInstance[0]).toBe(0);
    instances.update(q, w);
    expect(instances.data[0]).toBe(9999);
    expect(instances.data[6]).toBe(10049);
    expect(instances.data[9999 * 12]).toBe(0);
    b.build(q, w, false);
    expect(b.count).toBe(10000);
  });
  it("breaks batches for any incompatible state and retains sorted transparency order", () => {
    // Verifies breaks batches for any incompatible state and retains sorted transparency order.

    const w = new RenderWorld(5),
      q = new RenderQueue(5),
      b = new BatchBuilder(5);
    w.count = q.count = 5;
    q.order.set([0, 1, 2, 3, 4]);
    w.materialId.set([0, 0, 1, 0, 0]);
    w.meshId[4] = 1;
    q.pipeline[3] = 4;
    b.build(q, w);
    expect(b.count).toBe(4);
    expect(Array.from(b.instanceCount.subarray(0, 4))).toEqual([2, 1, 1, 1]);
    expect(Array.from(b.firstInstance.subarray(0, 4))).toEqual([0, 2, 3, 4]);
  });
});
