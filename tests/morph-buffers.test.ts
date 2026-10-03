import { describe, it, expect, vi } from "vitest";
import { MorphDeltaBuffers } from "../src/rendering/MorphDeltaBuffers";
import { MorphWeightBuffer } from "../src/rendering/MorphWeightBuffer";
import { MorphTargetData } from "../src/animation/MorphTargetData";
import { MorphStatePool } from "../src/animation/MorphStatePool";
import { Resources } from "../src/gpu/Resources";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderExtractor } from "../src/rendering/RenderExtractor";
import { World } from "../src/ecs/World";
Object.assign(globalThis, {
  GPUBufferUsage: { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4 },
});
describe("shared morph buffers", () => {
  it("creates exactly three shared delta buffers, packs vec4 deltas and zero-fills missing streams", () => {
    const device = {
        createBuffer: vi.fn((d) => ({ size: d.size, destroy: vi.fn() })),
      } as unknown as GPUDevice,
      queue = { writeBuffer: vi.fn() } as unknown as GPUQueue,
      resources = new Resources(device),
      deltas = new MorphDeltaBuffers(resources, queue, 2);
    const data = new MorphTargetData(
      [{ POSITION: new Float32Array([1, 2, 3]) }],
      1,
    );
    expect(deltas.append(data)).toBe(0);
    expect(deltas.append(data)).toBe(1);
    expect(resources.stats.bufferCreations).toBe(3);
    expect(queue.writeBuffer).toHaveBeenNthCalledWith(
      1,
      deltas.position,
      0,
      new Float32Array([1, 2, 3, 0]),
    );
    expect(queue.writeBuffer).toHaveBeenNthCalledWith(
      2,
      deltas.normal,
      0,
      new Float32Array(4),
    );
    expect(() => deltas.append(data)).toThrow("capacity");
    expect(deltas.count).toBe(2);
  });
  it("snapshots independent weights and uploads only dirty scalar ranges", () => {
    const pool = new MorphStatePool(4),
      id = pool.create(2, [0.2, 0.3]),
      world = new World(2),
      e = world.create();
    world.transforms.add(e);
    world.meshes.set(e, 0, 0);
    world.bounds.setSphere(e, 0, 0, 0, 1);
    world.morphs.add(e);
    world.morphs.stateId[e] = id;
    const out = new RenderWorld(2, 2, 4),
      extractor = new RenderExtractor();
    extractor.extract(world, out, undefined, pool);
    expect(out.activeMorphStates).toBe(1);
    expect(out.activeMorphTargets).toBe(2);
    expect(out.morphWeights.buffer).not.toBe(pool.data.buffer);
    expect(pool.states[id]!.dirty).toBe(false);
    extractor.extract(world, out, undefined, pool);
    expect(out.morphDirty[0]).toBe(1);
    const resources = new Resources({
        createBuffer: () => ({}),
      } as unknown as GPUDevice),
      weights = new MorphWeightBuffer(resources.buffers, 4),
      queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    weights.upload(queue, out);
    expect(weights.uploadBytes).toBe(8);
    weights.upload(queue, out);
    expect(weights.uploadBytes).toBe(0);
    pool.states[id]!.weights[1] = 0.7;
    pool.states[id]!.dirty = true;
    extractor.extract(world, out, undefined, pool);
    weights.upload(queue, out);
    expect(weights.uploadBytes).toBe(4);
    expect(out.morphWeights[1]).toBeCloseTo(0.7);
  });
});

it("reports nonzero signed weights separately from attached target capacity", () => {
  const pool = new MorphStatePool(3),
    id = pool.create(3, [-0.3, 0, 0.7]),
    world = new World(1),
    e = world.create();
  world.transforms.add(e);
  world.meshes.set(e, 0, 0);
  world.bounds.setSphere(e, 0, 0, 0, 1);
  world.morphs.add(e);
  world.morphs.stateId[e] = id;
  const out = new RenderWorld(1, 1, 3);
  new RenderExtractor().extract(world, out, undefined, pool);
  expect(out.activeMorphTargets).toBe(2);
  expect(out.morphTargets).toBe(3);
});
