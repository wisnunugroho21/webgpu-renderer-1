import { describe, it, expect, vi } from "vitest";
import { JointMatrixBuffer } from "../src/rendering/JointMatrixBuffer";
import { BufferManager } from "../src/gpu/BufferManager";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { InstanceManager } from "../src/rendering/InstanceManager";
import { RenderQueue } from "../src/rendering/RenderQueue";
Object.assign(globalThis, {
  GPUBufferUsage: { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4 },
});
describe("shared joint buffer", () => {
  // Groups checks for shared joint buffer.

  it("creates one buffer and uploads/coalesces only dirty ranges", () => {
    // Verifies creates one buffer and uploads/coalesces only dirty ranges.

    const gpuBuffer = {} as GPUBuffer,
      manager = {
        create: vi.fn(() => /** Returns gpu buffer. */ gpuBuffer),
      } as unknown as BufferManager;
    const joints = new JointMatrixBuffer(manager, 8),
      world = new RenderWorld(2, 8),
      queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    world.jointCount = 5;
    world.jointDirty.set([0, 1, 1, 0, 1]);
    joints.upload(queue, world);
    expect(manager.create).toHaveBeenCalledTimes(1);
    expect(joints.uploadBytes).toBe(192);
    expect(joints.updatedJoints).toBe(3);
    expect(joints.writes).toBe(2);
    expect(queue.writeBuffer).toHaveBeenNthCalledWith(
      1,
      gpuBuffer,
      64,
      world.jointMatrices.buffer,
      64,
      128,
    );
    expect(queue.writeBuffer).toHaveBeenNthCalledWith(
      2,
      gpuBuffer,
      256,
      world.jointMatrices.buffer,
      256,
      64,
    );
    joints.upload(queue, world);
    expect(joints.uploadBytes).toBe(0);
    expect(queue.writeBuffer).toHaveBeenCalledTimes(2);
  });
  it("propagates distinct palette ranges into batched instance records", () => {
    // Verifies propagates distinct palette ranges into batched instance records.

    const w = new RenderWorld(2),
      q = new RenderQueue(2),
      instances = new InstanceManager(2);
    w.count = q.count = 2;
    q.order.set([1, 0]);
    w.jointOffset.set([10, 20]);
    w.jointCounts.set([5, 8]);
    instances.update(q, w);
    expect(Array.from(instances.data.slice(2, 4))).toEqual([20, 8]);
    expect(Array.from(instances.data.slice(14, 16))).toEqual([10, 5]);
  });
});
