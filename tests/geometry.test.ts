import { describe, expect, it, vi } from "vitest";
import { MeshClusters } from "../src/rendering/geometry/MeshClusters";
import { GeometryOptimization } from "../src/rendering/geometry/GeometryOptimization";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderQueue } from "../src/rendering/RenderQueue";
import { BatchBuilder } from "../src/rendering/BatchBuilder";
import { MeshManager } from "../src/rendering/MeshManager";
import { Resources } from "../src/gpu/Resources";
import { DynamicBufferAllocator } from "../src/gpu/DynamicBufferAllocator";
Object.assign(globalThis, {
  GPUBufferUsage: {
    STORAGE: 128,
    COPY_DST: 8,
    COPY_SRC: 4,
    INDIRECT: 256,
    UNIFORM: 64,
  },
  GPUShaderStage: { COMPUTE: 4 },
});
const make = (supported = true, capacity = 8) => {
  const device = {
    features: new Set(supported ? ["indirect-first-instance"] : []),
    createBuffer: vi.fn((d: GPUBufferDescriptor) => ({
      size: d.size,
      destroy: vi.fn(),
    })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
  } as unknown as GPUDevice;
  const resources = new Resources(device),
    dynamic = {
      alignment: 256,
      buffers: [{}, {}, {}],
    } as unknown as DynamicBufferAllocator;
  const g = new GeometryOptimization(device, resources, dynamic, 8, capacity),
    world = new RenderWorld(8),
    q = new RenderQueue(8),
    b = new BatchBuilder(8);
  world.count = q.count = 3;
  q.order.set([2, 0, 1]);
  b.count = 2;
  b.firstInstance.set([0, 2]);
  b.instanceCount.set([2, 1]);
  const clusters = new MeshClusters(
    new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0]),
    new Uint32Array([0, 1, 2, 2, 1, 0]),
    1,
  );
  const meshes = {
    get: () => ({ topology: 0, clusters }),
  } as unknown as MeshManager;
  const queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
  const prepare = (indirect = false) =>
    g.prepare(b, q, world, meshes, new Float32Array(16), true, indirect, queue);
  return { g, device, world, q, b, queue, prepare };
};
describe("optional geometry clusters", () => {
  it("covers every original index exactly once and encloses referenced vertices including a partial tail", () => {
    const positions = new Float32Array([
        -3, 2, 1, 9, -4, 2, 0, 0, -8, 30, 0, 0,
      ]),
      indices = new Uint32Array([0, 1, 2, 2, 1, 0, 1, 2, 3]);
    const c = new MeshClusters(positions, indices, 2);
    expect([...c.firstIndex]).toEqual([0, 6]);
    expect([...c.indexCount]).toEqual([6, 3]);
    expect([...c.bounds.slice(0, 3)]).toEqual([-3, -4, -8]);
    expect([...c.bounds.slice(4, 7)]).toEqual([9, 2, 2]);
    let next = 0;
    for (let i = 0; i < c.count; i++) {
      expect(c.firstIndex[i]).toBe(next);
      for (let j = next; j < next + c.indexCount[i]!; j++)
        for (let a = 0; a < 3; a++) {
          const v = positions[indices[j]! * 3 + a]!;
          expect(v).toBeGreaterThanOrEqual(c.bounds[i * 8 + a]!);
          expect(v).toBeLessThanOrEqual(c.bounds[i * 8 + 4 + a]!);
        }
      next += c.indexCount[i]!;
    }
    expect(next).toBe(indices.length);
    expect([...indices]).toEqual([0, 1, 2, 2, 1, 0, 1, 2, 3]);
  });
  it("rejects malformed topology, out-of-range indices and nonfinite positions", () => {
    expect(
      () => new MeshClusters(new Float32Array(9), new Uint32Array([0, 1])),
    ).toThrow();
    expect(
      () => new MeshClusters(new Float32Array(9), new Uint32Array([0, 1, 3])),
    ).toThrow(/range/);
    expect(
      () =>
        new MeshClusters(
          new Float32Array([NaN, 0, 0]),
          new Uint32Array([0, 0, 0]),
        ),
    ).toThrow(/position/);
  });
  it("allocates no GPU resources and uploads nothing while disabled; enables only on the cold setter", () => {
    const { g, device, queue, prepare } = make();
    prepare();
    expect(g.enabled).toBe(false);
    expect(g.data.byteLength).toBe(0);
    expect(g.count).toBe(0);
    expect(device.createBuffer).not.toHaveBeenCalled();
    expect(queue.writeBuffer).not.toHaveBeenCalled();
    g.enabled = true;
    prepare();
    expect(g.count).toBe(6);
    expect(device.createBuffer).toHaveBeenCalledTimes(3);
    const bits = new Uint32Array(g.data.buffer);
    expect([...bits.slice(8, 12)]).toEqual([3, 0, 1, 0]);
    expect([...bits.slice(68, 72)]).toEqual([3, 3, 1, 2]);
    expect(g.uploadBytes).toBe(80 + 6 * 48);
    prepare();
    expect(g.uploadBytes).toBe(80);
    expect(device.createBuffer).toHaveBeenCalledTimes(3);
    g.enabled = false;
    prepare();
    expect(g.count).toBe(0);
    expect([...g.clusterCount.slice(0, 2)]).toEqual([0, 0]);
  });
  it("falls back atomically for overflowing batches, deformation, transparency and GPU object indirect mode", () => {
    const { g, world, b, prepare } = make(true, 4);
    g.enabled = true;
    prepare();
    expect(g.count).toBe(4);
    expect(g.fallbackBatches).toBe(1);
    expect([...g.clusterCount.slice(0, 2)]).toEqual([4, 0]);
    world.morphCounts[2] = 1;
    prepare();
    expect([...g.clusterCount.slice(0, 2)]).toEqual([0, 2]);
    world.morphCounts[2] = 0;
    world.jointCounts[0] = 1;
    b.pipeline[1] = 12;
    prepare();
    expect(g.count).toBe(0);
    expect(g.fallbackBatches).toBe(2);
    world.jointCounts[0] = 0;
    b.pipeline[1] = 0;
    prepare(true);
    expect(g.count).toBe(0);
  });
  it("unsupported adapters retain the conventional path without allocating GPU resources", () => {
    const { g, device, prepare } = make(false);
    g.enabled = true;
    prepare();
    expect(g.count).toBe(0);
    expect(g.fallbackBatches).toBe(2);
    expect(device.createBuffer).not.toHaveBeenCalled();
  });
});
