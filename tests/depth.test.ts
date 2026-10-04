import { describe, it, expect, vi } from "vitest";
import { DepthPrepass } from "../src/rendering/DepthPrepass";
import { RendererStats } from "../src/profiling/RendererStats";
import { Resources } from "../src/gpu/Resources";
import { ShadowManager } from "../src/rendering/shadows/ShadowManager";
import { MeshManager } from "../src/rendering/MeshManager";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { MaterialTextures } from "../src/rendering/materials/MaterialTextures";
import { BatchBuilder } from "../src/rendering/BatchBuilder";
import { GPUProfiler } from "../src/profiling/GPUProfiler";
describe("optional depth prepass", () => {
  // Groups checks for optional depth prepass.

  it("submits opaque and mask batches through shared groups while excluding blend", () => {
    // Verifies submits opaque and mask batches through shared groups while excluding blend.

    const get = vi.fn((d) => /** Returns d. */ d),
      groups = [{}],
      geometry = {
        descriptors: [{ depthStencil: { format: "depth32float" } }],
        groups,
        passGroups: groups,
      } as unknown as ShadowManager;
    const resources = { pipelines: { get } } as unknown as Resources,
      mesh = { indexCount: 6, topology: 0, vertex: {}, index: {} },
      meshes = {
        /** Returns mesh. */
        get: () => mesh,
      } as unknown as MeshManager;
    const materials = {
        alphaMode: new Uint8Array([0, 1, 2]),
        doubleSided: new Uint8Array(3),
      } as unknown as MaterialManager,
      textures = {
        groups: [{}, {}, {}],
        fallback: {},
      } as unknown as MaterialTextures;
    const depth = new DepthPrepass(
        resources,
        geometry,
        meshes,
        materials,
        textures,
      ),
      drawIndexed = vi.fn(),
      pass = {
        setBindGroup: vi.fn(),
        setPipeline: vi.fn(),
        setVertexBuffer: vi.fn(),
        setIndexBuffer: vi.fn(),
        drawIndexed,
        end: vi.fn(),
      },
      encoder = {
        beginRenderPass: vi.fn(() => /** Returns pass. */ pass),
      } as unknown as GPUCommandEncoder,
      stats = new RendererStats();
    const batches = {
        count: 3,
        material: new Uint32Array([0, 1, 2]),
        mesh: new Uint32Array(3),
        instanceCount: new Uint32Array([4, 2, 1]),
        firstInstance: new Uint32Array([0, 4, 6]),
      } as unknown as BatchBuilder,
      profiler = {
        /** Returns undefined. */
        writes: () => undefined,
      } as unknown as GPUProfiler;
    depth.encode(
      encoder,
      {} as GPUTextureView,
      0,
      256,
      batches,
      stats,
      profiler,
    );
    expect(encoder.beginRenderPass).not.toHaveBeenCalled();
    depth.enabled = true;
    depth.encode(
      encoder,
      {} as GPUTextureView,
      0,
      256,
      batches,
      stats,
      profiler,
    );
    expect(drawIndexed.mock.calls).toEqual([
      [6, 4, 0, 0, 0],
      [6, 2, 0, 0, 4],
    ]);
    expect(stats.depthTriangles).toBe(12);
    expect(stats.depthDrawCalls).toBe(2);
    expect(stats.depthPasses).toBe(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(pass.setBindGroup).toHaveBeenCalledWith(0, groups[0], [256]);
  });
});
