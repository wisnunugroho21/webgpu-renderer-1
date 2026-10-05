import { MATERIAL_WORDS } from "../src/rendering/layouts";
import { describe, it, expect, vi } from "vitest";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import {
  MaterialShaderRegistry,
  MAX_MATERIAL_SHADER_FAMILIES,
} from "../src/rendering/materials/MaterialShaderRegistry";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderQueue } from "../src/rendering/RenderQueue";
import { BatchBuilder } from "../src/rendering/BatchBuilder";

const source =
  "fn shadeMaterial(s: MaterialSurface, p: MaterialShaderParameters) -> vec3<f32> { return s.baseColor.rgb; }";

describe("custom surface material families", () => {
  // Covers registration contracts, shared data lifetime and family-aware batching.
  it("publishes only explicit commits, deduplicates names and bounds family count", () => {
    // Failed or pending registration must not become available to material creation.
    const registry = new MaterialShaderRegistry();
    const candidate = registry.candidate({ name: "unlit", source });
    expect(registry.get(candidate.id)).toBeUndefined();
    registry.commit(candidate);
    expect(registry.candidate({ name: "unlit", source })).toBe(candidate);
    expect(() =>
      /** Attempt to replace a registered name with different WGSL; identity must remain stable. */ registry.candidate(
        { name: "unlit", source: source + "\n// different" },
      ),
    ).toThrow("different");
    for (let i = 1; i < MAX_MATERIAL_SHADER_FAMILIES; i++)
      registry.commit(registry.candidate({ name: `family${i}`, source }));
    expect(() =>
      /** Attempt one more family after filling the bounded registry. */ registry.candidate(
        { name: "overflow", source },
      ),
    ).toThrow("capacity");
  });
  it("rejects custom coverage and entry points while allowing comments", () => {
    // Surface extensions must preserve depth/shadow coverage and shared bindings.
    const registry = new MaterialShaderRegistry();
    expect(() =>
      /** Try custom discard to verify color, depth and shadow coverage cannot diverge. */ registry.candidate(
        {
          name: "discard",
          source: source.replace("return", "discard; return"),
        },
      ),
    ).toThrow("coverage");
    expect(() =>
      /** Try an extra texture binding to verify the shared surface layout stays fixed. */ registry.candidate(
        {
          name: "binding",
          source: "@group(3) @binding(0) var t: texture_2d<f32>;" + source,
        },
      ),
    ).toThrow("bindings");
    expect(() =>
      /** Try source without the required surface function to verify registration rejects it. */ registry.candidate(
        { name: "missing", source: "fn other() {}" },
      ),
    ).toThrow("shadeMaterial");
    expect(
      registry.candidate({
        name: "comment",
        source: "// @fragment discard\n" + source,
      }).id,
    ).toBe(1);
  });
  it("keeps PBR ABI and uploads only dirty shared custom rows", () => {
    // Changing parameters must preserve surface factors and avoid unchanged-frame writes.
    const manager = new MaterialManager(4);
    const shader = manager.shaders.candidate({ name: "unlit", source });
    manager.shaders.commit(shader);
    const id = manager.create({
      shaderId: shader.id,
      roughness: 0.2,
      shaderParameters: [1, 2, 3],
    });
    expect(manager.data.length).toBe(4 * MATERIAL_WORDS);
    expect(manager.colorPipelineIndex(id, 0)).toBe(18);
    const queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    const buffer = {} as GPUBuffer;
    manager.uploadShaderParameters(queue, buffer);
    expect(manager.shaderUploadBytes).toBe(64);
    manager.uploadShaderParameters(queue, buffer);
    expect(manager.shaderUploadBytes).toBe(0);
    const factors = manager.data.slice();
    manager.setShader(id, 0);
    expect(manager.data).toEqual(factors);
    expect(manager.shaderParameters[0]).toBe(1);
    manager.setShader(id, shader.id);
    expect(manager.colorPipelineIndex(id, 0)).toBe(18);
    manager.setShaderParameters(id, [4]);
    expect(Array.from(manager.shaderParameters.slice(0, 4))).toEqual([
      4, 0, 0, 0,
    ]);
    expect(manager.data[5]).toBeCloseTo(0.2);
    manager.uploadShaderParameters(queue, buffer);
    expect(manager.shaderUploadBytes).toBe(64);
    const snapshot = manager.shaderParameters.slice();
    expect(() =>
      /** Attempt an unknown family without modifying the existing material. */ manager.set(
        id,
        { shaderId: 99 },
      ),
    ).toThrow("Unknown");
    expect(() =>
      /** Attempt a finite JavaScript value that overflows the GPU f32 representation. */ manager.setShaderParameters(
        id,
        [1e100],
      ),
    ).toThrow("f32");
    expect(() =>
      /** Attempt a row larger than the four-vec4 parameter ABI. */ manager.setShaderParameters(
        id,
        new Float32Array(17),
      ),
    ).toThrow("16");
    expect(manager.shaderParameters).toEqual(snapshot);
    manager.release(id);
    const replacement = manager.create();
    expect(replacement).toBe(id);
    expect(manager.shaderIds[id]).toBe(0);
    expect(
      manager.shaderParameters.every(
        (value) =>
          /** Check that recycling clears every parameter, including zero-padded values. */ value ===
          0,
      ),
    ).toBe(true);
  });
  it("retains pending rows before buffer installation and clears diagnostics on a failed upload", () => {
    // Lazy setup and failed device writes must not consume the dirty CPU range.
    const manager = new MaterialManager(4);
    const id = manager.create({ shaderParameters: [1] });
    const parameters = manager.shaderParameters;
    const queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    const buffer = {} as GPUBuffer;
    manager.uploadShaderParameters(queue);
    expect(manager.shaderUploadBytes).toBe(0);
    expect(queue.writeBuffer).not.toHaveBeenCalled();
    manager.uploadShaderParameters(queue, buffer);
    expect(manager.shaderUploadBytes).toBe(64);
    manager.setShaderParameters(id, [2]);
    vi.mocked(queue.writeBuffer).mockImplementationOnce(() => {
      // Simulate a synchronous device failure before the row can be committed.
      throw new Error("device write failed");
    });
    expect(() =>
      /** Attempt a device write failure to verify pending rows survive for retry. */ manager.uploadShaderParameters(
        queue,
        buffer,
      ),
    ).toThrow("device write failed");
    expect(manager.shaderUploadBytes).toBe(0);
    manager.uploadShaderParameters(queue, buffer);
    expect(manager.shaderUploadBytes).toBe(64);
    expect(queue.writeBuffer).toHaveBeenLastCalledWith(
      buffer,
      0,
      parameters.buffer,
      0,
      64,
    );
    expect(manager.shaderParameters).toBe(parameters);
    expect(parameters[0]).toBe(2);
    manager.uploadShaderParameters(queue, buffer);
    expect(manager.shaderUploadBytes).toBe(0);
  });
  it("retains family IDs above 255 and separates transparent LOD batches", () => {
    // Pipeline storage must not truncate the final custom family or merge transparent instances.
    const world = new RenderWorld(4, 1, 1, 1);
    world.count = 4;
    world.materialId.fill(1);
    world.meshId.fill(0);
    world.lodGroup.fill(0);
    const queue = new RenderQueue(4);
    queue.count = 4;
    queue.order.set([0, 1, 2, 3]);
    queue.pipeline.set([288, 288, 300, 300]);
    const batches = new BatchBuilder(4);
    batches.build(queue, world, true, true);
    expect(batches.count).toBe(3);
    expect(Array.from(batches.pipeline.slice(0, 3))).toEqual([288, 300, 300]);
    expect(Array.from(batches.instanceCount.slice(0, 3))).toEqual([2, 1, 1]);
  });
});
