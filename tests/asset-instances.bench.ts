import { bench } from "vitest";
import { AssetInstances } from "../src/assets/AssetInstances";
import { World } from "../src/ecs/World";
import { AnimationSystem } from "../src/ecs/systems/AnimationSystem";
import { SkeletonRegistry } from "../src/animation/skinning/SkeletonRegistry";

const world = new World(16);
const animations = new AnimationSystem();
const skeletons = new SkeletonRegistry();
const instances = new AssetInstances(world, animations, skeletons);
let leases = 0;
bench(
  "register/dispose 1000 independent scene lifetimes with reused slots",
  () => {
    // Measures register/dispose 1000 independent scene lifetimes with reused slots.

    for (let i = 0; i < 1000; i++) {
      const node = world.createHandle();
      world.transforms.add(world.require(node));
      leases++;
      instances
        .addEntities("shared", [node], () => /** Returns leases--. */ leases--)
        .dispose();
    }
    if (world.count !== 0 || world.nextEntity !== 1 || leases !== 0)
      throw new Error("Unbounded scene lifetime");
  },
);
