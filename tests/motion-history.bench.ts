import { bench } from "vitest";
import { MotionHistory } from "../src/rendering/post/MotionHistory";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
for (const count of [1000, 10000]) {
  const world = new RenderWorld(count),
    materials = new MaterialManager(1),
    history = new MotionHistory(
      count,
      world.jointCapacity,
      world.morphCapacity,
    );
  materials.create({});
  world.count = count;
  for (let i = 0; i < count; i++) {
    world.entityId[i] = i;
    world.entityGeneration[i] = 1;
  }
  history.prepare(world, materials);
  history.capture(world, materials);
  bench(`${count} generational temporal pose remaps`, () => {
    // Measure identity matching and fixed pose packing/capture without GPU allocation or palette readbacks.
    history.prepare(world, materials);
    history.capture(world, materials);
  });
}
