import { bench, describe } from "vitest";
import { World } from "../src/ecs/World";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
const world = new World(10000),
  system = new TransformSystem(10000);
for (let i = 0; i < 10000; i++) world.transforms.add(world.create());
system.update(world.transforms);
describe("Phase 6: 10,000 entities", () => {
  // Groups checks for Phase 6: 10,000 entities.

  bench("100 dirty transforms", () => {
    // Measures 100 dirty transforms.

    for (let i = 0; i < 100; i++) world.transforms.setPosition(i, i, 1, 0);
    if (system.update(world.transforms) !== 100)
      throw new Error("Wrong dirty count");
  });
  bench("10,000 full update baseline", () => {
    // Measures 10,000 full update baseline.

    for (let i = 0; i < 10000; i++) world.transforms.setPosition(i, i, 1, 0);
    if (system.update(world.transforms) !== 10000)
      throw new Error("Wrong update count");
  });
});
