import { describe, expect, it, vi } from "vitest";
import { PipelineCache } from "../src/gpu/PipelineCache";
import { SamplerCache } from "../src/gpu/SamplerCache";
import { ShaderManager } from "../src/gpu/ShaderManager";
import { BufferManager } from "../src/gpu/BufferManager";
import { TextureManager } from "../src/gpu/TextureManager";
import { ResourceStats } from "../src/gpu/ResourceStats";
class Opaque {}
/** Builds a record containing layout, vertex, fragment, depth stencil. */
const descriptor = (): GPURenderPipelineDescriptor => ({
  layout: "auto",
  vertex: {
    module: new Opaque() as GPUShaderModule,
    buffers: [
      {
        arrayStride: 12,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
      },
    ],
  },
  fragment: {
    module: new Opaque() as GPUShaderModule,
    targets: [{ format: "bgra8unorm" }],
  },
  depthStencil: {
    format: "depth24plus",
    depthWriteEnabled: true,
    depthCompare: "less",
  },
});
describe("resource ownership and cache correctness", () => {
  // Groups checks for resource ownership and cache correctness.

  it("reuses shaders by source and samplers by normalized state", () => {
    // Verifies reuses shaders by source and samplers by normalized state.

    const stats = new ResourceStats(),
      device = {
        createShaderModule: vi.fn(
          () => /** Creates Opaque storage for this operation. */ new Opaque(),
        ),
        createSampler: vi.fn(
          () => /** Creates Opaque storage for this operation. */ new Opaque(),
        ),
      } as unknown as GPUDevice;
    const shaders = new ShaderManager(device, stats),
      samplers = new SamplerCache(device, stats);
    expect(shaders.get("code", "first")).toBe(shaders.get("code", "renamed"));
    expect(samplers.get()).toBe(samplers.get({ magFilter: "nearest" }));
    expect(samplers.get({ magFilter: "linear" })).not.toBe(samplers.get());
    expect(stats.shaderModules).toBe(1);
    expect(stats.samplerCreations).toBe(2);
  });
  it("ignores labels/property order and includes every pipeline state dimension", () => {
    // Verifies ignores labels/property order and includes every pipeline state dimension.

    const stats = new ResourceStats(),
      device = {
        createRenderPipeline: vi.fn(
          () => /** Creates Opaque storage for this operation. */ new Opaque(),
        ),
      } as unknown as GPUDevice;
    const cache = new PipelineCache(device, stats),
      d = descriptor(),
      first = cache.get(d);
    expect(
      cache.get({
        ...d,
        label: "other",
        primitive: {
          cullMode: "none",
          topology: "triangle-list",
          frontFace: "ccw",
        },
      }),
    ).toBe(first);
    const variants: GPURenderPipelineDescriptor[] = [
      {
        ...d,
        vertex: { ...d.vertex, module: new Opaque() as GPUShaderModule },
      },
      {
        ...d,
        vertex: {
          ...d.vertex,
          buffers: [
            {
              arrayStride: 24,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
              ],
            },
          ],
        },
      },
      { ...d, primitive: { topology: "line-list" } },
      { ...d, primitive: { cullMode: "back" } },
      { ...d, depthStencil: { ...d.depthStencil!, depthCompare: "greater" } },
      {
        ...d,
        fragment: { ...d.fragment!, targets: [{ format: "rgba8unorm" }] },
      },
      {
        ...d,
        fragment: {
          ...d.fragment!,
          targets: [
            {
              format: "bgra8unorm",
              blend: {
                color: {
                  srcFactor: "src-alpha",
                  dstFactor: "one-minus-src-alpha",
                },
                alpha: {},
              },
            },
          ],
        },
      },
      { ...d, multisample: { count: 4 } },
    ];
    for (const variant of variants) expect(cache.get(variant)).not.toBe(first);
    expect(stats.pipelineCreations).toBe(9);
    expect(stats.cacheHits).toBe(1);
  });
  it("destroys each owned resource once and accurately tracks live bytes", () => {
    // Verifies destroys each owned resource once and accurately tracks live bytes.

    const stats = new ResourceStats(),
      device = {
        createBuffer: vi.fn(
          (
            d: GPUBufferDescriptor,
          ) => /** Builds a record containing size, destroy. */ ({
            size: d.size,
            destroy: vi.fn(),
          }),
        ),
        createTexture: vi.fn(() => /** Builds a record containing destroy. */ ({
          destroy: vi.fn(),
        })),
      } as unknown as GPUDevice;
    const buffers = new BufferManager(device, stats),
      textures = new TextureManager(device, stats);
    const buffer = buffers.create({ size: 64, usage: 1 }),
      texture = textures.create({
        size: [1, 1],
        format: "rgba8unorm",
        usage: 1,
      });
    expect(stats.bufferBytes).toBe(64);
    expect(stats.buffers).toBe(1);
    expect(stats.textures).toBe(1);
    buffers.destroy(buffer);
    buffers.destroy(buffer);
    textures.destroy(texture);
    textures.dispose();
    buffers.dispose();
    expect(buffer.destroy).toHaveBeenCalledTimes(1);
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(stats.bufferBytes).toBe(0);
    expect(stats.buffers).toBe(0);
    expect(stats.textures).toBe(0);
  });
});
