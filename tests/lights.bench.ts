import { bench, describe } from "vitest";
import { World } from "../src/ecs/World";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderExtractor } from "../src/rendering/RenderExtractor";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
const w = new World(1000),
  out = new RenderWorld(1),
  extractor = new RenderExtractor();
for (let i = 0; i < 1000; i++) {
  const e = w.create();
  w.transforms.add(e);
  w.transforms.setPosition(e, i % 10, Math.floor(i / 10), 0);
  w.lights.set(e, { type: "point", range: 10, intensity: 1 });
}
new TransformSystem(1000).update(w.transforms);
describe("Phase 28 shared lights", () => {
  bench("extract/compare 1,000 light records", () => {
    extractor.extract(w, out);
  });
});
