import { describe, expect, it } from "vitest";
import { World } from "../src/ecs/World";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderExtractor } from "../src/rendering/RenderExtractor";
describe("render extraction snapshot", () => {
  it("compacts renderable entities and copies independent renderer data", () => {
    const w = new World(4),
      out = new RenderWorld(4),
      extractor = new RenderExtractor();
    w.create();
    const e = w.create();
    w.transforms.add(e);
    w.transforms.setPosition(e, 5, 0, 0);
    w.meshes.set(e, 2, 3, 7);
    w.bounds.setSphere(e, 0, 0, 0, 1);
    w.skins.add(e);
    w.skins.instanceId[e] = 4;
    w.morphs.add(e);
    w.morphs.stateId[e] = 5;
    new TransformSystem(4).update(w.transforms);
    expect(extractor.extract(w, out)).toBe(1);
    expect(out.entityId[0]).toBe(e);
    expect(out.meshId[0]).toBe(2);
    expect(out.materialId[0]).toBe(3);
    expect(out.transformIndex[0]).toBe(0);
    expect(out.skinInstanceId[0]).toBe(4);
    expect(out.morphStateId[0]).toBe(5);
    expect(out.flags[0]).toBe(7);
    expect(out.sphere[0]).toBe(5);
    expect(out.boundsMin[0]).toBe(4);
    expect(out.boundsMax[0]).toBe(6);
    w.transforms.worldMatrices[e * 16 + 12] = 20;
    expect(out.matrices[12]).toBe(5);
    w.destroy(e);
    expect(extractor.extract(w, out)).toBe(0);
  });
  it("rejects overflow and requires complete rendering components", () => {
    const w = new World(2),
      extractor = new RenderExtractor();
    for (let i = 0; i < 2; i++) {
      w.transforms.add(w.create());
      w.meshes.set(i, 0, 0);
    }
    expect(extractor.extract(w, new RenderWorld(1))).toBe(0);
    w.bounds.setSphere(0, 0, 0, 0, 1);
    w.bounds.setSphere(1, 0, 0, 0, 1);
    new TransformSystem(2).update(w.transforms);
    expect(() => extractor.extract(w, new RenderWorld(1))).toThrow("capacity");
  });
});
