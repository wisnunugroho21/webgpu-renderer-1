import { bench, describe } from "vitest";
import { World } from "../src/ecs/World";
const world = new World(1000);
describe("safe entity lifetime", () => {
  // Groups checks for safe entity lifetime.

  bench("1000 recyclable create/resolve/destroy lifetimes", () => {
    // Measures 1000 recyclable create/resolve/destroy lifetimes.

    for (let i = 0; i < 1000; i++) {
      const entity = world.createHandle();
      world.transforms.add(world.require(entity));
      world.destroy(entity);
    }
  });
});
