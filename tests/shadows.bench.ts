import { ShadowSceneCache } from "../src/rendering/shadows/ShadowSceneCache";
import { Frustum } from "../src/math/Frustum";
import { FrustumCuller } from "../src/visibility/FrustumCuller";
import { bench, describe } from "vitest";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { Camera } from "../src/rendering/Camera";
import { ShadowCamera } from "../src/rendering/shadows/ShadowCamera";
const world = new RenderWorld(10000);
world.count = 10000;
world.lightData.set([0, 0, 0, 0, 1, 1, 1, 3, -0.4, -0.6, -0.6928203, 0]);
for (let i = 0; i < 10000; i++)
  for (let axis = 0; axis < 3; axis++) {
    world.boundsMin[i * 3 + axis] = (i % 100) - 1;
    world.boundsMax[i * 3 + axis] = (i % 100) + 1;
  }
const camera = new Camera();
camera.update(4 / 3);
const shadow = new ShadowCamera();
const frustum = new Frustum(),
  culler = new FrustumCuller(world.capacity);
shadow.fit(camera, world, 0, 0.1, 30, 1024);
frustum.setFromMatrix(shadow.matrix);
const cache = new ShadowSceneCache(world),
  records = new Uint32Array(world.capacity * 12);
cache.update(world, records, world.count, 0);
describe("shadow camera", () => {
  // Groups checks for shadow camera.

  bench("compare 10,000 unchanged shadow casters", () => {
    // Measures compare 10,000 unchanged shadow casters.

    cache.update(world, records, world.count, 0);
  });
  bench("cull 10,000 shadow caster bounds", () => {
    // Measures cull 10,000 shadow caster bounds.

    culler.cull(world, frustum);
  });
  bench("fit 10,000 caster bounds", () => {
    // Measures fit 10,000 caster bounds.

    shadow.fit(camera, world, 0, 0.1, 30, 1024);
  });
});

const localWorld = new RenderWorld(1),
  localCamera = new ShadowCamera();
localWorld.lightData[11] = 1;
bench("fit six point shadow faces", () => {
  // Point projections use retained matrix scratch and do not traverse caster bounds.
  for (let face = 0; face < 6; face++)
    localCamera.fitLocal(localWorld, 0, face, 0.05, 30);
});
const spotWorld = new RenderWorld(1);
spotWorld.lightData[11] = 2;
spotWorld.lightData[10] = -1;
spotWorld.lightData[13] = Math.cos(0.5);
bench("fit one spot shadow cone", () => {
  // Measure cold projection arithmetic separately from per-face caster culling.
  localCamera.fitLocal(spotWorld, 0, 0, 0.05, 30);
});
