import { describe, it, expect, vi } from "vitest";
import { VisibilityCompactor } from "../src/rendering/visibility/VisibilityCompactor";
import { GPUFrustumCuller } from "../src/rendering/visibility/GPUFrustumCuller";
import { Resources } from "../src/gpu/Resources";
describe("GPU visibility append", () => {
  it("clears stale counters on every capture including zero candidates", () => {
    vi.stubGlobal("GPUShaderStage", { COMPUTE: 1 });
    vi.stubGlobal("GPUBufferUsage", { STORAGE: 1, COPY_SRC: 2, COPY_DST: 4 });
    const create = vi.fn((d) => d),
      getCompute = vi.fn((d) => d),
      device = {
        createBindGroupLayout: (d: unknown) => d,
        createPipelineLayout: (d: unknown) => d,
        createBindGroup: (d: unknown) => d,
      } as unknown as GPUDevice,
      resources = {
        buffers: { create },
        pipelines: { getCompute },
        shaders: { get: () => ({}) },
      } as unknown as Resources,
      frustum = {
        count: 0,
        capacity: 65,
        visibility: {},
        params: {},
      } as unknown as GPUFrustumCuller;
    const compactor = new VisibilityCompactor(device, resources, frustum),
      pass = {
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      },
      encoder = {
        clearBuffer: vi.fn(),
        beginComputePass: vi.fn(() => pass),
      } as unknown as GPUCommandEncoder;
    compactor.encode(encoder);
    expect(encoder.clearBuffer).not.toHaveBeenCalled();
    compactor.enabled = true;
    compactor.encode(encoder);
    expect(encoder.clearBuffer).toHaveBeenCalledTimes(1);
    expect(encoder.beginComputePass).not.toHaveBeenCalled();
    frustum.count = 65;
    compactor.encode(encoder);
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(2);
    expect(encoder.clearBuffer).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(getCompute).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
