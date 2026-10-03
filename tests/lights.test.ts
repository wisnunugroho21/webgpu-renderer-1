import { describe, it, expect, vi } from "vitest";
import { World } from "../src/ecs/World";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
import { RenderExtractor } from "../src/rendering/RenderExtractor";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { LightBuffer } from "../src/rendering/LightBuffer";
import { BufferManager } from "../src/gpu/BufferManager";
Object.assign(globalThis, { GPUBufferUsage: { STORAGE: 128, COPY_DST: 8 } });
describe("shared lighting data", () => {
  it("transforms point position/spot direction, packs factors and skips unchanged uploads", () => {
    const world = new World(2),
      e = world.create();
    world.transforms.add(e);
    world.transforms.setPosition(e, 1, 2, 3);
    world.transforms.setRotation(e, 0, Math.SQRT1_2, 0, Math.SQRT1_2);
    world.lights.set(e, {
      type: "spot",
      intensity: 4,
      color: [0.2, 0.3, 0.4],
      range: 10,
      innerCone: 0.1,
      outerCone: 0.3,
    });
    new TransformSystem(2).update(world.transforms);
    const snapshot = new RenderWorld(1),
      extractor = new RenderExtractor();
    extractor.extract(world, snapshot);
    expect(snapshot.lightCount).toBe(1);
    expect(Array.from(snapshot.lightData.slice(0, 4))).toEqual([1, 2, 3, 10]);
    expect(snapshot.lightData[7]).toBe(4);
    expect(snapshot.lightData[8]).toBeCloseTo(-1);
    expect(snapshot.lightData[11]).toBe(2);
    expect(snapshot.lightData[12]).toBeCloseTo(Math.cos(0.1));
    const buffer = new LightBuffer(
        { create: () => ({}) } as unknown as BufferManager,
        1024,
      ),
      queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    buffer.upload(queue, snapshot);
    expect(buffer.uploadBytes).toBe(64);
    extractor.extract(world, snapshot);
    buffer.upload(queue, snapshot);
    expect(buffer.uploadBytes).toBe(0);
    world.lights.remove(e);
    extractor.extract(world, snapshot);
    expect(snapshot.lightCount).toBe(0);
  });
  it("validates light properties and gives added components valid defaults", () => {
    const w = new World(1),
      e = w.create();
    w.lights.add(e);
    expect(w.lights.direction[2]).toBe(-1);
    expect(w.lights.intensity[0]).toBe(1);
    expect(() => w.lights.set(e, { type: "point", intensity: -1 })).toThrow();
    expect(() =>
      w.lights.set(e, { type: "spot", innerCone: 1, outerCone: 0.5 }),
    ).toThrow();
    expect(() =>
      w.lights.set(e, { type: "directional", direction: [0, 0, 0] }),
    ).toThrow();
    expect(w.lights.intensity[0]).toBe(1);
  });
});
