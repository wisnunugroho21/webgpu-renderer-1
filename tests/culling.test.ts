import { describe, expect, it } from "vitest";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { FrustumCuller } from "../src/visibility/FrustumCuller";
import { Frustum } from "../src/math/Frustum";
import { Mat4 } from "../src/math/Mat4";
describe("allocation-free frustum culling", () => {
  // Groups checks for allocation-free frustum culling.

  it("keeps touching bounds and rejects each outside clip plane for spheres and boxes", () => {
    // Verifies keeps touching bounds and rejects each outside clip plane for spheres and boxes.

    const w = new RenderWorld(9),
      f = new Frustum(),
      c = new FrustumCuller(9);
    f.setFromMatrix(Mat4.create());
    w.count = 9;
    const positions = [
      [0, 0, 0.5],
      [2, 0, 0.5],
      [-2, 0, 0.5],
      [0, 2, 0.5],
      [0, -2, 0.5],
      [0, 0, -1],
      [0, 0, 2],
      [0, 0, -0.1],
      [1.1, 0, 0.5],
    ];
    positions.forEach((p, i) => {
      // Applies w.sphere.set to the current callback state.

      w.sphere.set([...p, 0.1], i * 4);
      for (let a = 0; a < 3; a++) {
        w.boundsMin[i * 3 + a] = p[a]! - 0.1;
        w.boundsMax[i * 3 + a] = p[a]! + 0.1;
      }
    });
    for (const mode of ["sphere", "aabb"] as const) {
      expect(c.cull(w, f, mode)).toBe(3);
      expect(Array.from(c.visible.subarray(0, 3))).toEqual([0, 7, 8]);
      expect(c.frustumTested).toBe(9);
      expect(c.frustumRejected).toBe(6);
    }
  });
  it("matches direct clip-space point inequalities for a perspective camera", () => {
    // Verifies matches direct clip-space point inequalities for a perspective camera.

    const w = new RenderWorld(1000),
      f = new Frustum(),
      c = new FrustumCuller(1000),
      matrix = Mat4.create(),
      point = new Float32Array(3);
    Mat4.perspective(matrix, Math.PI / 2, 1, 0.1, 100);
    f.setFromMatrix(matrix);
    w.count = 1000;
    for (let i = 0; i < 1000; i++) {
      const p = [
        ((i % 10) - 4.5) * 3,
        ((Math.floor(i / 10) % 10) - 4.5) * 3,
        -Math.floor(i / 100) * 3 - 0.5,
      ];
      w.sphere.set([...p, 0], i * 4);
      w.boundsMin.set(p, i * 3);
      w.boundsMax.set(p, i * 3);
      Mat4.transformPoint(point, matrix, p);
      const expected =
        Math.abs(point[0]!) <= 1 &&
        Math.abs(point[1]!) <= 1 &&
        point[2]! >= 0 &&
        point[2]! <= 1;
      expect(c.intersects(w, i, f, "sphere")).toBe(expected);
      expect(c.intersects(w, i, f, "aabb")).toBe(expected);
    }
  });
});
