import { describe, it, expect } from "vitest";
import { LODGroups } from "../src/rendering/lod/LODGroups";
import { LODSelector } from "../src/rendering/lod/LODSelector";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { Camera } from "../src/rendering/Camera";
import { MeshManager } from "../src/rendering/MeshManager";
const bounds = {
    min: new Float32Array([-1, -1, -1]),
    max: new Float32Array([1, 1, 1]),
  },
  mesh = { topology: 0, bounds },
  meshes = {
    /** Returns mesh. */
    get: () => mesh,
  } as unknown as MeshManager;
describe("screen-space LOD", () => {
  // Groups checks for screen-space LOD.

  /** Builds controlled test dependencies and reusable state for screen-space LOD. */
  const setup = () => {
    const groups = new LODGroups(),
      id = groups.register([10, 11, 12], [128, 64, 16], meshes),
      selector = new LODSelector(2, groups),
      world = new RenderWorld(2),
      camera = new Camera();
    world.count = 1;
    world.entityId[0] = 0;
    world.lodGroup[0] = id;
    world.sphere.set([0, 0, 0, 1]);
    camera.setPosition(0, 0, 5);
    camera.update(1);
    return { groups, selector, world, camera };
  };
  it("selects detail by projected physical pixels and culls tiny objects", () => {
    // Verifies selects detail by projected physical pixels and culls tiny objects.

    const { selector, world, camera } = setup();
    for (const [distance, lod, id] of [
      [5, 0, 10],
      [15, 1, 11],
      [60, 2, 12],
      [200, -1, 12],
    ]) {
      camera.setPosition(0, 0, distance!);
      camera.update(1);
      const count = selector.select(world, camera, 800);
      expect(world.lodSelection[0]).toBe(lod);
      expect(count).toBe(lod! >= 0 ? 1 : 0);
      expect(world.meshId[0]).toBe(id);
    }
  });
  it("holds LOD across boundary jitter in both directions", () => {
    // Verifies holds LOD across boundary jitter in both directions.

    const { selector, world, camera } = setup();
    /** Returns world lod selection[0]. */
    const select = (pixels: number) => {
      camera.setPosition(0, 0, 1 + (camera.projection[5]! * 800) / pixels);
      camera.update(1);
      selector.select(world, camera, 800);
      return world.lodSelection[0];
    };
    expect(select(160)).toBe(0);
    expect(select(120)).toBe(0);
    expect(select(100)).toBe(1);
    expect(select(130)).toBe(1);
    expect(select(160)).toBe(0);
    expect(select(20)).toBe(2);
    expect(select(15)).toBe(2);
    expect(select(13)).toBe(-1);
    expect(select(17)).toBe(-1);
    expect(select(20)).toBe(2);
  });
  it("preserves input visibility order and leaves unassigned meshes active", () => {
    // Verifies preserves input visibility order and leaves unassigned meshes active.

    const { selector, world, camera } = setup();
    world.count = 2;
    world.entityId[1] = 1;
    world.meshId[1] = 99;
    selector.select(world, camera, 800, new Uint32Array([1, 0]), 2);
    expect(Array.from(selector.visible)).toEqual([1, 0]);
    expect(world.meshId[1]).toBe(99);
    expect(selector.distribution[0]).toBe(1);
  });
  it("rejects nondecreasing thresholds and geometry outside base bounds", () => {
    // Verifies rejects nondecreasing thresholds and geometry outside base bounds.

    const groups = new LODGroups();
    expect(() =>
      /** Delegates this operation to groups.register. */ groups.register(
        [0, 1],
        [32, 128],
        meshes,
      ),
    ).toThrow();
    const bad = {
      /** Selects the result according to id === 0. */
      get: (id: number) =>
        id === 0
          ? mesh
          : {
              ...mesh,
              bounds: { min: new Float32Array([-2, -1, -1]), max: bounds.max },
            },
    } as unknown as MeshManager;
    expect(() =>
      /** Delegates this operation to groups.register. */ groups.register(
        [0, 1],
        [128, 32],
        bad,
      ),
    ).toThrow("bounds");
  });
});
