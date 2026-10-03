import { describe, it, expect, vi } from "vitest";
import { GPUFrustumCuller } from "../src/rendering/visibility/GPUFrustumCuller";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { Resources } from "../src/gpu/Resources";
describe("GPU object snapshots", () => {
  it("packs float bounds/numeric IDs, uploads changes and reuses dispatch resources", () => {
    vi.stubGlobal("GPUBufferUsage", {
      STORAGE: 1,
      COPY_DST: 2,
      COPY_SRC: 4,
      UNIFORM: 8,
    });
    vi.stubGlobal("GPUShaderStage", { COMPUTE: 1 });
    const create = vi.fn((d: unknown) => d),
      getCompute = vi.fn((d: unknown) => d),
      device = {
        createBindGroupLayout: (d: unknown) => d,
        createPipelineLayout: (d: unknown) => d,
        createBindGroup: (d: unknown) => d,
      } as unknown as GPUDevice,
      resources = {
        buffers: { create },
        pipelines: { getCompute },
        shaders: { get: () => ({}) },
      } as unknown as Resources;
    const culler = new GPUFrustumCuller(
        device,
        resources,
        [{} as GPUBuffer],
        65,
      ),
      world = new RenderWorld(65, 1, 1, 1),
      writeBuffer = vi.fn(),
      queue = { writeBuffer } as unknown as GPUQueue;
    world.count = 2;
    world.sphere.set([1, 2, 3, 0.5, 4, 5, 6, 0.25]);
    world.meshId[0] = 7;
    world.materialId[0] = 9;
    world.transformIndex[0] = 11;
    world.flags[0] = 0x10000;
    culler.update(world, queue);
    expect(writeBuffer).not.toHaveBeenCalled();
    culler.enabled = true;
    culler.update(world, queue);
    expect(culler.uploadBytes).toBe(80);
    expect(Array.from(culler.data.slice(0, 4))).toEqual([1, 2, 3, 0.5]);
    expect(Array.from(culler.ids.slice(4, 8))).toEqual([7, 9, 11, 0x10000]);
    culler.update(world, queue);
    expect(culler.uploadBytes).toBe(0);
    world.sphere[4] = 8;
    culler.update(world, queue);
    expect(culler.uploadBytes).toBe(32);
    expect(writeBuffer.mock.calls.at(-1)!.slice(1)).toEqual([
      32,
      culler.data.buffer,
      32,
      32,
    ]);
    world.count = 65;
    culler.update(world, queue);
    const dispatchWorkgroups = vi.fn(),
      pass = {
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups,
        end: vi.fn(),
      },
      encoder = {
        beginComputePass: () => pass,
      } as unknown as GPUCommandEncoder;
    culler.encode(encoder, 0);
    culler.encode(encoder, 0);
    expect(dispatchWorkgroups.mock.calls).toEqual([[2], [2]]);
    expect(create).toHaveBeenCalledTimes(3);
    expect(getCompute).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
