import { describe, it, expect, vi } from "vitest";
import { HiZPyramid } from "../src/rendering/visibility/HiZPyramid";
import { Resources } from "../src/gpu/Resources";
describe("Hi-Z pyramid lifecycle", () => {
  it("prepares isolated mip views/groups on resize and reuses them for dispatch", () => {
    vi.stubGlobal("GPUShaderStage", { COMPUTE: 1, FRAGMENT: 2 });
    vi.stubGlobal("GPUTextureUsage", {
      STORAGE_BINDING: 1,
      TEXTURE_BINDING: 2,
      COPY_SRC: 4,
    });
    const createView = vi.fn((d) => ({ d })),
      create = vi.fn(() => ({ createView })),
      destroy = vi.fn(),
      createBindGroup = vi.fn((d) => d),
      device = {
        createBindGroupLayout: (d: unknown) => d,
        createPipelineLayout: (d: unknown) => d,
        createBindGroup,
      } as unknown as GPUDevice;
    const resources = {
      textures: { create, destroy },
      pipelines: { getCompute: (d: unknown) => d, get: (d: unknown) => d },
      shaders: { get: () => ({}) },
    } as unknown as Resources;
    const hiz = new HiZPyramid(device, resources, "bgra8unorm-srgb");
    hiz.resize(5, 3, {} as GPUTextureView);
    expect(hiz.widths).toEqual([5, 2, 1]);
    expect(hiz.heights).toEqual([3, 1, 1]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(createBindGroup).toHaveBeenCalledTimes(6);
    const pass = {
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      },
      encoder = {
        beginComputePass: vi.fn(() => pass),
      } as unknown as GPUCommandEncoder;
    hiz.encode(encoder);
    expect(encoder.beginComputePass).not.toHaveBeenCalled();
    hiz.enabled = true;
    hiz.encode(encoder);
    expect(hiz.passes).toBe(3);
    expect(pass.dispatchWorkgroups.mock.calls).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    hiz.resize(5, 3, {} as GPUTextureView);
    hiz.encode(encoder);
    expect(create).toHaveBeenCalledTimes(1);
    expect(createBindGroup).toHaveBeenCalledTimes(6);
    hiz.resize(9, 7, {} as GPUTextureView);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(hiz.levels).toBe(4);
    vi.unstubAllGlobals();
  });
});
