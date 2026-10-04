import { bench, describe } from "vitest";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { Frustum } from "../src/math/Frustum";
import { Mat4 } from "../src/math/Mat4";
import { FrustumCuller } from "../src/visibility/FrustumCuller";
import { BVH } from "../src/visibility/BVH";
import { RenderFlags } from "../src/rendering/RenderFlags";
const w = new RenderWorld(100000),
  frustum = new Frustum(),
  culler = new FrustumCuller(100000),
  all = new Uint32Array(100000);
w.count = 100000;
frustum.setFromMatrix(Mat4.create());
for (let i = 0; i < w.count; i++) {
  const x = (i % 1000) / 50 - 10,
    y = Math.floor(i / 1000) / 5 - 10;
  w.sphere.set([x, y, 0.5, 0.02], i * 4);
  w.boundsMin.set([x - 0.01, y - 0.01, 0.49], i * 3);
  w.boundsMax.set([x + 0.01, y + 0.01, 0.51], i * 3);
}
const bvh = new BVH(w.capacity);
w.flags.fill(RenderFlags.STATIC);
bvh.build(w);
describe("Phase 11: 100,000 objects", () => {
  // Groups checks for Phase 11: 100,000 objects.

  bench("no culling enumeration baseline", () => {
    // Measures no culling enumeration baseline.

    for (let i = 0; i < w.count; i++) all[i] = i;
  });
  bench("linear CPU sphere frustum", () => {
    // Measures linear CPU sphere frustum.

    culler.cull(w, frustum, "sphere");
  });
  bench("linear CPU AABB frustum", () => {
    // Measures linear CPU AABB frustum.

    culler.cull(w, frustum, "aabb");
  });
  bench("Phase 12 static BVH frustum", () => {
    // Measures Phase 12 static BVH frustum.

    bvh.cull(w, frustum, culler);
  });
});
