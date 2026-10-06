import { bench } from "vitest";
import { ShadowBudget } from "../src/rendering/shadows/ShadowBudget";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { Camera } from "../src/rendering/Camera";
for (const count of [32, 1024]) {
  const world = new RenderWorld(1, 1, 1, count),
    camera = new Camera(),
    budget = new ShadowBudget(count, 1024, 16);
  world.lightCount = count;
  budget.enabled = true;
  budget.configure({ maxLayers: 12, maxTexels: 4 * 1024 * 1024 });
  for (let i = 0; i < count; i++) {
    world.lightShadow[i] = 1;
    world.lightEntity[i] = i;
    const o = i * 16;
    world.lightData[o] = i % 100;
    world.lightData[o + 3] = 10;
    world.lightData[o + 4] = 1;
    world.lightData[o + 7] = (i * 17) % 100;
    world.lightData[o + 11] = (i % 2) + 1;
  }
  bench(`${count} adaptive shadow light candidates`, () => {
    // Measure fixed-table ranking and atomic face admission without rendering or GPU allocation.
    budget.select(world, camera, 4, 30);
  });
}
