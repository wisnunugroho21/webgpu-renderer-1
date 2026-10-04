import { bench } from "vitest";
import { SimulationLoop } from "../src/app/SimulationLoop";
import { Camera } from "../src/rendering/Camera";
import { CameraSystem } from "../src/ecs/systems/CameraSystem";
import { World } from "../src/ecs/World";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
const empty = new SimulationLoop();
bench("1000 empty gameplay frame dispatches", () => {
  // Measures 1000 empty gameplay frame dispatches.

  for (let i = 0; i < 1000; i++) empty.advance(1 / 60);
});
const populated = new SimulationLoop();
let time = 0;
for (let i = 0; i < 100; i++)
  populated.onFixedUpdate((dt) => {
    // Provides the controlled callback used by game-api.bench.ts.

    time += dt;
  });
bench("100 gameplay callbacks across 100 fixed frames", () => {
  // Measures 100 gameplay callbacks across 100 fixed frames.

  for (let i = 0; i < 100; i++) populated.advance(1 / 60);
  if (!Number.isFinite(time)) throw new Error("Simulation failed");
});
const camera = new Camera(),
  world = new World(1),
  entity = world.create();
world.transforms.add(entity);
world.cameras.setPerspective(entity);
new TransformSystem(1).update(world.transforms);
const system = new CameraSystem();
system.select(entity, world);
system.update(world, camera);
camera.update(1);
bench("1000 unchanged ECS camera updates", () => {
  // Measures 1000 unchanged ECS camera updates.

  for (let i = 0; i < 1000; i++) {
    system.update(world, camera);
    camera.update(1);
  }
});

import { CollectGame } from "../src/examples/CollectGame";
const game = new CollectGame();
bench("1000 collection-game fixed steps, six items", () => {
  // Measures 1000 collection-game fixed steps, six items.

  game.reset();
  for (let i = 0; i < 1000; i++) game.step(1 / 60, i % 2 ? 1 : -1, 0);
});
