import { GPULODSelector } from "../src/rendering/lod/GPULODSelector";
import { describe, it, expect, vi } from "vitest";
import { IndirectDraws } from "../src/rendering/visibility/IndirectDraws";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderQueue } from "../src/rendering/RenderQueue";
import { BatchBuilder } from "../src/rendering/BatchBuilder";
import { Resources } from "../src/gpu/Resources";
import { VisibilityCompactor } from "../src/rendering/visibility/VisibilityCompactor";
import { MeshManager } from "../src/rendering/MeshManager";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
describe("GPU indexed argument generation", () => {
  // Groups checks for GPU indexed argument generation.

  it("prepares stable batch/object mappings and leaves arguments to the GPU", () => {
    // Verifies prepares stable batch/object mappings and leaves arguments to the GPU.

    vi.stubGlobal("GPUShaderStage", { COMPUTE: 1 });
    vi.stubGlobal("GPUBufferUsage", {
      STORAGE: 1,
      COPY_SRC: 2,
      COPY_DST: 4,
      UNIFORM: 8,
      INDIRECT: 16,
    });
    const create = vi.fn((d) => /** Returns d. */ d),
      getCompute = vi.fn((d) => /** Returns d. */ d),
      device = {
        features: new Set(["indirect-first-instance"]),
        /** Returns d. */
        createBindGroupLayout: (d: unknown) => d,
        /** Returns d. */
        createPipelineLayout: (d: unknown) => d,
        /** Returns d. */
        createBindGroup: (d: unknown) => d,
      } as unknown as GPUDevice,
      resources = {
        buffers: { create },
        pipelines: { getCompute },
        shaders: {
          /** Returns an empty fixture handle for a controlled test dependency. */
          get: () => ({}),
        },
      } as unknown as Resources;
    const draws = new IndirectDraws(
        device,
        resources,
        4,
        {
          counter: {},
          visibleInstances: {},
        } as VisibilityCompactor,
        {
          selections: {},
          registry: { entries: [] },
        } as unknown as GPULODSelector,
      ),
      world = new RenderWorld(4, 1, 1, 1),
      queue = new RenderQueue(4),
      batches = new BatchBuilder(4),
      meshes = {
        /** Builds a record containing index count, topology. */
        get: () => ({ indexCount: 6, topology: 0 }),
      } as unknown as MeshManager,
      materials = {
        alphaMode: new Uint8Array([0, 2]),
        /** Computes the id * 2 result. */
        pipelineIndex: (id: number) => id * 2,
      } as unknown as MaterialManager,
      writeBuffer = vi.fn(),
      gpu = { writeBuffer } as unknown as GPUQueue;
    world.count = 3;
    queue.count = 3;
    queue.order.set([2, 0, 1]);
    batches.count = 2;
    batches.firstInstance.set([0, 2]);
    batches.instanceCount.set([2, 1]);
    batches.material.set([0, 1]);
    draws.enabled = true;
    draws.prepare(world, queue, batches, meshes, materials, gpu);
    expect(Array.from(draws.data.slice(0, 16))).toEqual([
      6, 2, 0, 0, 0, 0, 0, 0, 6, 1, 2, 1, 0, 0, 0, 0,
    ]);
    expect(Array.from(draws.objectData.slice(0, 5))).toEqual([1, 1, 0, 0, 0]);
    expect(draws.uploadBytes).toBe(224);
    expect(
      writeBuffer.mock.calls.some(
        (args) =>
          /** Evaluates the args[0] === draws.arguments condition. */ args[0] ===
          draws.arguments,
      ),
    ).toBe(false);
    draws.prepare(world, queue, batches, meshes, materials, gpu);
    expect(draws.uploadBytes).toBe(0);
    const pass = {
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      },
      encoder = {
        beginComputePass: vi.fn(() => /** Returns pass. */ pass),
      } as unknown as GPUCommandEncoder;
    draws.encode(encoder);
    expect(encoder.beginComputePass).toHaveBeenCalledTimes(2);
    expect(pass.dispatchWorkgroups.mock.calls).toEqual([[1], [1]]);
    expect(create).toHaveBeenCalledTimes(5);
    expect(getCompute).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
