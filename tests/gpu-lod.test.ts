import { describe, it, expect, vi } from "vitest";
import { GPULODSelector } from "../src/rendering/lod/GPULODSelector";
import { GPUFrustumCuller } from "../src/rendering/visibility/GPUFrustumCuller";
import { LODGroups } from "../src/rendering/lod/LODGroups";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { Resources } from "../src/gpu/Resources";
describe("GPU LOD metadata", () => {
  // Groups checks for GPU LOD metadata.

  it("updates persistent authored groups and entity metadata without warm allocations", () => {
    // Verifies updates persistent authored groups and entity metadata without warm allocations.

    vi.stubGlobal("GPUShaderStage", { COMPUTE: 1 });
    vi.stubGlobal("GPUBufferUsage", { STORAGE: 1, COPY_SRC: 2, COPY_DST: 4 });
    const create = vi.fn((d) => /** Returns d. */ d),
      getCompute = vi.fn((d) => /** Returns d. */ d),
      device = {
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
      } as unknown as Resources,
      frustum = {
        capacity: 10,
        count: 1,
        objects: {},
        visibility: {},
        params: {},
      } as unknown as GPUFrustumCuller;
    const registry = {
        entries: [
          {
            meshes: new Uint32Array([5, 6]),
            thresholds: new Float32Array([200, 80]),
            hysteresis: 0.15,
          },
        ],
      } as LODGroups,
      selector = new GPULODSelector(
        device,
        resources,
        [{} as GPUBuffer],
        frustum,
        registry,
      ),
      world = new RenderWorld(10, 1, 1, 1),
      writeBuffer = vi.fn(),
      queue = { writeBuffer } as unknown as GPUQueue;
    world.count = 1;
    world.lodGroup[0] = 0;
    world.entityId[0] = 7;
    world.meshId[0] = 5;
    selector.enabled = true;
    selector.prepare(world, queue);
    expect(selector.uploadBytes).toBe(96);
    selector.prepare(world, queue);
    expect(selector.uploadBytes).toBe(0);
    world.entityId[0] = 8;
    selector.prepare(world, queue);
    expect(selector.uploadBytes).toBe(4);
    expect(writeBuffer.mock.calls.at(-1)![0]).toBe(selector.objectBuffer);
    registry.entries[0]!.thresholds[0] = 220;
    selector.prepare(world, queue);
    expect(selector.uploadBytes).toBe(4);
    expect(writeBuffer.mock.calls.at(-1)![0]).toBe(selector.groupBuffer);
    const pass = {
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      },
      encoder = {
        clearBuffer: vi.fn(),
        /** Returns pass. */
        beginComputePass: () => pass,
      } as unknown as GPUCommandEncoder;
    selector.encode(encoder, 0);
    selector.encode(encoder, 0);
    expect(encoder.clearBuffer).toHaveBeenCalledTimes(2);
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(1);
    expect(create).toHaveBeenCalledTimes(6);
    expect(getCompute).toHaveBeenCalledTimes(1);
    world.entityId[0] = 10;
    expect(() =>
      /** Delegates this operation to selector.prepare. */ selector.prepare(
        world,
        queue,
      ),
    ).toThrow(/capacity/);
    vi.unstubAllGlobals();
  });
});
