import { bench } from "vitest";
import { Ray } from "../src/spatial/Ray";
import { RayHit, SpatialQueries } from "../src/spatial/SpatialQueries";
import { RenderWorld } from "../src/rendering/RenderWorld";
const world = new RenderWorld(10000),
  ray = new Ray(),
  hit = new RayHit(),
  out = new Uint32Array(10000);
world.count = 10000;
for (let i = 0; i < world.count; i++) {
  const x = (i % 100) * 3,
    y = Math.floor(i / 100) * 3;
  world.boundsMin.set([x - 1, y - 1, -1], i * 3);
  world.boundsMax.set([x + 1, y + 1, 1], i * 3);
}
const queries = new SpatialQueries(world);
ray.set([0, 0, 10], [0, 0, -1]);
const min = new Float32Array([-2, -2, -2]),
  max = new Float32Array([15, 15, 2]);
bench("raycast 10000 snapshot bounds", () => {
  // Measures raycast 10000 snapshot bounds.

  queries.raycast(ray, hit);
});
bench("AABB query 10000 snapshot bounds", () => {
  // Measures AABB query 10000 snapshot bounds.

  queries.queryAABB(min, max, out);
});
