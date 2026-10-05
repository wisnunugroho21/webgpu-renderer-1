import { MATERIAL_WORDS, MATERIAL_BYTES } from "../src/rendering/layouts";
import { describe, expect, it, vi } from "vitest";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { MaterialFlags } from "../src/rendering/materials/MaterialFlags";
describe("shared material data", () => {
  // Groups checks for shared material data.

  it("encodes properties and bounded pipeline indices", () => {
    // Verifies encodes properties and bounded pipeline indices.

    const m = new MaterialManager(2),
      id = m.create({
        baseColor: [0.2, 0.3, 0.4, 0.5],
        metallic: 0.8,
        roughness: 0.2,
        alphaMode: "MASK",
        doubleSided: true,
      });
    expect(m.data[id * MATERIAL_WORDS + 4]).toBeCloseTo(0.8);
    expect(m.pipelineIndex(id)).toBe(3);
    expect(m.flags[id]).toBe(
      MaterialFlags.ALPHA_MASK | MaterialFlags.DOUBLE_SIDED,
    );
    m.set(id, { alphaMode: "BLEND" });
    expect(m.pipelineIndex(id)).toBe(4);
    expect(m.data[id * MATERIAL_WORDS]).toBe(1);
  });
  it("uploads changed ranges and skips unchanged data", () => {
    // Verifies uploads changed ranges and skips unchanged data.

    const m = new MaterialManager(3);
    for (let i = 0; i < 3; i++) m.create();
    const buffer = {} as GPUBuffer,
      queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    m.upload(queue, buffer);
    expect(m.uploadBytes).toBe(3 * MATERIAL_BYTES);
    m.upload(queue, buffer);
    expect(m.uploadBytes).toBe(0);
    m.set(1, { roughness: 0.3 });
    m.upload(queue, buffer);
    expect(queue.writeBuffer).toHaveBeenLastCalledWith(
      buffer,
      MATERIAL_BYTES,
      m.data.buffer,
      MATERIAL_BYTES,
      MATERIAL_BYTES,
    );
    expect(m.uploadBytes).toBe(MATERIAL_BYTES);
  });
  it("rejects capacity and invalid values", () => {
    // Verifies rejects capacity and invalid values.

    const m = new MaterialManager(1);
    expect(() =>
      /** Delegates this operation to m.create. */ m.create({ roughness: 2 }),
    ).toThrow();
    expect(m.count).toBe(0);
    m.create();
    expect(() =>
      /** Delegates this operation to m.create. */ m.create(),
    ).toThrow("capacity");
    expect(() =>
      /** Delegates this operation to m.set. */ m.set(5, {}),
    ).toThrow();
  });
});

it("updates streamed UV/normal metadata and revisions, then restores the original layout", () => {
  // Verifies updates streamed UV/normal metadata and revisions, then restores the original layout.

  const manager = new MaterialManager(),
    id = manager.create({
      baseColor: [0.2, 0.3, 0.4, 1],
      textures: { baseColor: { texCoord: 0 } },
    });
  const old = manager.textureLayout(id),
    revision = manager.revision;
  manager.setTextureSlots(id, {
    baseColor: { texCoord: 1 },
    normal: { texCoord: 1 },
    emissive: { texCoord: 1 },
  });
  expect(manager.textureLayout(id)).toEqual(
    new Float32Array([1, 1, 1, 0, 1, 0]),
  );
  expect(manager.revision).toBeGreaterThan(revision);
  expect(Array.from(manager.data.slice(0, 3))).toEqual([
    Math.fround(0.2),
    Math.fround(0.3),
    Math.fround(0.4),
  ]);
  manager.setTextureLayout(id, old);
  expect(manager.textureLayout(id)).toEqual(old);
  expect(() =>
    /** Delegates this operation to manager.setTextureSlots. */ manager.setTextureSlots(
      id,
      { normal: { texCoord: 2 } },
    ),
  ).toThrow("TEXCOORD");
  expect(manager.textureLayout(id)).toEqual(old);
});
