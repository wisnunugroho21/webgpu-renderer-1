import { bench, describe } from "vitest";
import { LODGroups } from "../src/rendering/lod/LODGroups";
import { LODSelector } from "../src/rendering/lod/LODSelector";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { Camera } from "../src/rendering/Camera";
import { MeshManager } from "../src/rendering/MeshManager";
const mesh = {
    topology: 0,
    bounds: {
      min: new Float32Array([-1, -1, -1]),
      max: new Float32Array([1, 1, 1]),
    },
  },
  groups = new LODGroups();
groups.register([0, 1, 2], [128, 32, 8], {
  /** Returns mesh. */
  get: () => mesh,
} as unknown as MeshManager);
const world = new RenderWorld(10000),
  camera = new Camera(),
  selector = new LODSelector(10000, groups);
world.count = 10000;
camera.update(4 / 3);
for (let i = 0; i < 10000; i++) {
  world.entityId[i] = i;
  world.lodGroup[i] = 0;
  world.sphere[i * 4 + 2] = -(i % 100);
  world.sphere[i * 4 + 3] = 1;
}
describe("Phase 27 screen-space LOD", () => {
  // Groups checks for Phase 27 screen-space LOD.

  bench("10,000 candidates with persistent hysteresis", () => {
    // Measures 10,000 candidates with persistent hysteresis.

    selector.select(world, camera, 1080);
  });
});
