import { describe, it, expect, vi } from "vitest";
import { ClusteredLighting } from "../src/rendering/lighting/ClusteredLighting";
import { Resources } from "../src/gpu/Resources";
import { RenderWorld } from "../src/rendering/RenderWorld";
Object.assign(globalThis, {
  GPUBufferUsage: { STORAGE: 128, COPY_SRC: 4 },
  GPUShaderStage: { COMPUTE: 4 },
});
const setup = () => {
  const device = {
    createBuffer: vi.fn((d) => ({ size: d.size, destroy: vi.fn() })),
    createBindGroupLayout: vi.fn((d) => ({ descriptor: d })),
    createBindGroup: vi.fn((d) => ({ descriptor: d })),
    createPipelineLayout: vi.fn((d) => ({ descriptor: d })),
    createShaderModule: vi.fn((d) => ({ descriptor: d })),
    createComputePipeline: vi.fn((d) => ({ descriptor: d })),
  } as unknown as GPUDevice;
  const resources = new Resources(device),
    clusters = new ClusteredLighting(
      device,
      resources,
      [{} as GPUBuffer, {} as GPUBuffer, {} as GPUBuffer],
      {} as GPUBuffer,
      1280,
      960,
    );
  return { device, resources, clusters };
};
describe("shared GPU light clusters", () => {
  it("keeps viewport tiling within fixed shared storage without new buffers", () => {
    const { resources, clusters } = setup();
    for (const [w, h] of [
      [1, 1],
      [1280, 960],
      [8192, 8192],
      [16384, 16384],
    ]) {
      clusters.resize(w!, h!);
      expect(
        clusters.tilesX * clusters.tilesY * clusters.slices,
      ).toBeLessThanOrEqual(clusters.capacity);
    }
    expect(resources.stats.bufferCreations).toBe(2);
  });
  it("uses bounded many-light scenes automatically and caches compute pipelines", () => {
    const { resources, clusters } = setup(),
      world = new RenderWorld(1);
    world.lightCount = 64;
    for (let i = 0; i < 64; i++) {
      world.lightData[i * 16 + 3] = 2;
      world.lightData[i * 16 + 11] = 1;
    }
    expect(clusters.choose(world)).toBe(true);
    const pass = {
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      },
      encoder = {
        beginComputePass: vi.fn(() => pass),
      } as unknown as GPUCommandEncoder;
    for (let i = 0; i < 3; i++) clusters.encode(encoder, i);
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(20, 15, 24);
    expect(resources.stats.pipelineCreations).toBe(1);
    expect(resources.stats.bufferCreations).toBe(2);
    world.lightData.fill(0);
    expect(clusters.choose(world)).toBe(false);
    clusters.mode = "on";
    expect(clusters.choose(world)).toBe(true);
    clusters.mode = "off";
    expect(clusters.choose(world)).toBe(false);
  });
});
