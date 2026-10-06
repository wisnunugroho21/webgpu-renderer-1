import { describe, expect, it } from "vitest";
import {
  ShadowBudget,
  shadowTargetOptions,
} from "../src/rendering/shadows/ShadowBudget";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { Camera } from "../src/rendering/Camera";
/** Build a bounded scene containing point/spot/directional lights with deterministic priorities. */
function scene(types: number[]) {
  const world = new RenderWorld(1, 1, 1, types.length),
    camera = new Camera();
  camera.setPosition(0, 0, 0);
  world.lightCount = types.length;
  for (let i = 0; i < types.length; i++) {
    world.lightShadow[i] = 1;
    world.lightEntity[i] = i;
    const o = i * 16;
    world.lightData[o + 3] = 10;
    world.lightData[o + 4] = 1;
    world.lightData[o + 7] = types.length - i;
    world.lightData[o + 11] = types[i]!;
  }
  return { world, camera };
}
describe("adaptive shadow budget", () => {
  // Budget planning must select whole faces, preserve disabled defaults and bound all hot scratch.
  it("validates cold dimensions and atomic configuration", () => {
    // Malformed dimensions must fail before target construction or replacing a working budget.
    expect(shadowTargetOptions()).toEqual({ resolution: 1024, layers: 16 });
    expect(shadowTargetOptions({ resolution: 512, layers: 8 })).toEqual({
      resolution: 512,
      layers: 8,
    });
    const budget = new ShadowBudget(4, 1024, 16),
      previous = budget.options;
    for (const options of [
      { maxLayers: 17 },
      { maxTexels: -1 },
      { minResolution: 96 },
      { minResolution: 2048 },
    ])
      expect(() => {
        // Invalid edits must leave the complete prior configuration intact.
        budget.configure(options);
      }).toThrow();
    expect(budget.options).toBe(previous);
    expect(() => {
      // Non-power-of-two cold targets are rejected.
      shadowTargetOptions({ resolution: 1000 });
    }).toThrow();
  });
  it("admits complete light units and degrades resolution within the texel budget", () => {
    // A point must reserve all six faces before publication; a rejected light has zero coverage.
    const { world, camera } = scene([1, 2, 2]),
      budget = new ShadowBudget(3, 1024, 16);
    budget.enabled = true;
    budget.configure({ maxLayers: 7, maxTexels: 7 * 256 * 256 });
    budget.select(world, camera, 1, 30);
    expect(Array.from(budget.resolutions)).toEqual([256, 256, 0]);
    expect(budget.selectedLayers).toBe(7);
    expect(budget.selectedTexels).toBe(7 * 256 * 256);
    expect(budget.rejectedLights).toBe(1);
  });
  it("preserves authored full resolution when disabled and supports a zero budget", () => {
    // Feature disablement retains the legacy full-resolution caster selection.
    const { world, camera } = scene([0, 1, 2]),
      budget = new ShadowBudget(3, 1024, 16);
    budget.configure({ maxLayers: 0, maxTexels: 0 });
    budget.select(world, camera, 4, 30);
    expect(Array.from(budget.resolutions)).toEqual([1024, 1024, 1024]);
    budget.enabled = true;
    budget.select(world, camera, 4, 30);
    expect(budget.selectedLayers).toBe(0);
    expect(budget.rejectedLights).toBe(3);
  });
  it("prioritizes important nearby lights with selection hysteresis and entity identity", () => {
    // Modest intensity changes should not alternate assignments every frame.
    const { world, camera } = scene([2, 2]),
      budget = new ShadowBudget(2, 1024, 16);
    budget.enabled = true;
    budget.configure({ maxLayers: 1 });
    budget.select(world, camera, 1, 30);
    world.lightData[23] = 2.1;
    budget.select(world, camera, 1, 30);
    expect(budget.resolutions[0]).toBe(1024);
    world.lightEntity[0] = 50;
    budget.select(world, camera, 1, 30);
    expect(budget.resolutions[1]).toBe(1024);
    world.lightData[16] = 1000;
    budget.select(world, camera, 1, 30);
    expect(budget.resolutions[0]).toBe(1024);
  });
  it("bounds far lights and reset frames without replacing staging tables", () => {
    // Distance tiers reduce viewport work; empty frames clear stale allocations.
    const { world, camera } = scene([2]),
      budget = new ShadowBudget(1, 1024, 16),
      storage = budget.resolutions;
    budget.enabled = true;
    world.lightData[0] = 1000;
    budget.select(world, camera, 1, 30);
    expect(budget.resolutions[0]).toBe(128);
    world.lightCount = 0;
    budget.select(world, camera, 1, 30);
    expect(budget.selectedLights).toBe(0);
    expect(budget.resolutions[0]).toBe(0);
    expect(budget.resolutions).toBe(storage);
  });
});
