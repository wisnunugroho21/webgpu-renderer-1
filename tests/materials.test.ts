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
    expect(m.data[id * 8 + 4]).toBeCloseTo(0.8);
    expect(m.pipelineIndex(id)).toBe(3);
    expect(m.flags[id]).toBe(
      MaterialFlags.ALPHA_MASK | MaterialFlags.DOUBLE_SIDED,
    );
    m.set(id, { alphaMode: "BLEND" });
    expect(m.pipelineIndex(id)).toBe(4);
    expect(m.data[id * 8]).toBe(1);
  });
  it("uploads changed ranges and skips unchanged data", () => {
    const m = new MaterialManager(3);
    for (let i = 0; i < 3; i++) m.create();
    const buffer = {} as GPUBuffer,
      queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    m.upload(queue, buffer);
    expect(m.uploadBytes).toBe(96);
    m.upload(queue, buffer);
    expect(m.uploadBytes).toBe(0);
    m.set(1, { roughness: 0.3 });
    m.upload(queue, buffer);
    expect(queue.writeBuffer).toHaveBeenLastCalledWith(
      buffer,
      32,
      m.data.buffer,
      32,
      32,
    );
    expect(m.uploadBytes).toBe(32);
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
