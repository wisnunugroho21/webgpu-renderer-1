import { describe, expect, it, vi } from "vitest";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { MaterialFlags } from "../src/rendering/materials/MaterialFlags";
describe("shared material data", () => {
  it("encodes properties and bounded pipeline indices", () => {
    const m = new MaterialManager(2),
      id = m.create({
        baseColor: [0.2, 0.3, 0.4, 0.5],
        metallic: 0.8,
        roughness: 0.2,
        alphaMode: "MASK",
        doubleSided: true,
      });
    expect(m.data[id * 20 + 4]).toBeCloseTo(0.8);
    expect(m.pipelineIndex(id)).toBe(3);
    expect(m.flags[id]).toBe(
      MaterialFlags.ALPHA_MASK | MaterialFlags.DOUBLE_SIDED,
    );
    m.set(id, { alphaMode: "BLEND" });
    expect(m.pipelineIndex(id)).toBe(4);
    expect(m.data[id * 20]).toBe(1);
  });
  it("uploads changed ranges and skips unchanged data", () => {
    const m = new MaterialManager(3);
    for (let i = 0; i < 3; i++) m.create();
    const buffer = {} as GPUBuffer,
      queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    m.upload(queue, buffer);
    expect(m.uploadBytes).toBe(240);
    m.upload(queue, buffer);
    expect(m.uploadBytes).toBe(0);
    m.set(1, { roughness: 0.3 });
    m.upload(queue, buffer);
    expect(queue.writeBuffer).toHaveBeenLastCalledWith(
      buffer,
      80,
      m.data.buffer,
      80,
      80,
    );
    expect(m.uploadBytes).toBe(80);
  });
  it("rejects capacity and invalid values", () => {
    const m = new MaterialManager(1);
    expect(() => m.create({ roughness: 2 })).toThrow();
    expect(m.count).toBe(0);
    m.create();
    expect(() => m.create()).toThrow("capacity");
    expect(() => m.set(5, {})).toThrow();
  });
});

it("updates streamed UV/normal metadata and revisions, then restores the original layout", () => {
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
    manager.setTextureSlots(id, { normal: { texCoord: 2 } }),
  ).toThrow("TEXCOORD");
  expect(manager.textureLayout(id)).toEqual(old);
});
