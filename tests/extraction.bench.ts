import { bench } from "vitest";
import { World } from "../src/ecs/World";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderExtractor } from "../src/rendering/RenderExtractor";
const world = new World(10000),
  out = new RenderWorld(10000),
  extractor = new RenderExtractor();
for (let i = 0; i < 10000; i++) {
  world.transforms.add(world.create());
  world.meshes.set(i, 0, 0);
  world.bounds.setSphere(i, 0, 0, 0, 1);
}
new TransformSystem(10000).update(world.transforms);
bench("Phase 7: extract 10,000 renderables into persistent arrays", () => {
  if (extractor.extract(world, out) !== 10000)
    throw new Error("Extraction count");
});
