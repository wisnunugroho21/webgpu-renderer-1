import { expect, it } from "vitest";
import { Ray } from "../src/spatial/Ray";
import { RayHit, SpatialQueries } from "../src/spatial/SpatialQueries";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { Camera } from "../src/rendering/Camera";
/** Builds controlled test dependencies and reusable state for spatial. */
function fixture() {
  const world = new RenderWorld(3);
  world.count = 3;
  for (let i = 0; i < 3; i++) {
    world.entityId[i] = i + 10;
    world.entityGeneration[i] = 2;
    world.boundsMin.set([-1, -1, -i * 4 - 1], i * 3);
    world.boundsMax.set([1, 1, -i * 4 + 1], i * 3);
  }
  world.flags[1] = 4;
  return { world, queries: new SpatialQueries(world) };
}
it("returns nearest world-space bounds hit, finite ranges, parallel rays and inside hits", () => {
  // Verifies returns nearest world-space bounds hit, finite ranges, parallel rays and inside hits.

  const { queries } = fixture(),
    ray = new Ray(),
    hit = new RayHit();
  ray.set([0, 0, 5], [0, 0, -2]);
  expect(queries.raycast(ray, hit)).toBe(true);
  expect(hit.entityId).toBe(10);
  expect(hit.distance).toBe(4);
  expect(Array.from(hit.point)).toEqual([0, 0, 1]);
  expect(queries.raycast(ray, hit, 3)).toBe(false);
  expect(hit.entityId).toBe(-1);
  expect(queries.raycast(ray, hit, 20, 4)).toBe(true);
  expect(hit.entityId).toBe(11);
  ray.set([0, 0, 0], [1, 0, 0]);
  expect(queries.raycast(ray, hit)).toBe(true);
  expect(hit.distance).toBe(0);
  ray.set([2, 0, 5], [0, 0, -1]);
  expect(queries.raycast(ray, hit)).toBe(false);
  expect(() =>
    /** Delegates this operation to ray.set. */ ray.set([0, 0, 0], [0, 0, 0]),
  ).toThrow();
  expect(() =>
    /** Delegates this operation to queries.raycast. */ queries.raycast(
      ray,
      hit,
      NaN,
    ),
  ).toThrow();
});
it("queries inclusive AABB overlaps into fixed output with explicit overflow", () => {
  // Verifies queries inclusive AABB overlaps into fixed output with explicit overflow.

  const { queries } = fixture(),
    out = new Uint32Array(3);
  expect(queries.queryAABB([-1, -1, -6], [1, 1, 1], out)).toBe(2);
  expect(Array.from(out.slice(0, 2))).toEqual([0, 1]);
  expect(() =>
    /** Delegates this operation to queries.queryAABB. */ queries.queryAABB(
      [-1, -1, -6],
      [1, 1, 1],
      new Uint32Array(1),
    ),
  ).toThrow("capacity");
  expect(() =>
    /** Delegates this operation to queries.queryAABB. */ queries.queryAABB(
      [2, 0, 0],
      [1, 1, 1],
      out,
    ),
  ).toThrow();
});
it("unprojects perspective and orthographic rays with standard-Z depth", () => {
  // Verifies unprojects perspective and orthographic rays with standard-Z depth.

  const camera = new Camera(),
    ray = new Ray();
  camera.setPosition(0, 0, 5);
  camera.setTarget(0, 0, 0);
  ray.fromCamera(camera, 0.5, 0.5, 4 / 3);
  expect(Array.from(ray.origin)).toEqual([0, 0, 5]);
  expect(ray.direction[2]).toBeCloseTo(-1);
  camera.setOrthographic({ height: 10, near: 0.1, far: 100 });
  ray.fromCamera(camera, 0.75, 0.5, 1);
  expect(ray.origin[0]).toBeCloseTo(2.5);
  expect(ray.origin[2]).toBeCloseTo(4.9);
  expect(ray.direction[0]).toBeCloseTo(0);
});
