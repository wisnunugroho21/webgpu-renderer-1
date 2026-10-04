import { describe, expect, it } from "vitest";
import { Vec3 } from "../src/math/Vec3";
import { Quat } from "../src/math/Quat";
import { Mat4 } from "../src/math/Mat4";
import { AABB } from "../src/math/AABB";
import { BoundingSphere } from "../src/math/BoundingSphere";
import { Frustum } from "../src/math/Frustum";
import { Camera } from "../src/rendering/Camera";

/** Applies expect(actual[i]).toBeCloseTo, expect to close. */
function close(actual: ArrayLike<number>, expected: ArrayLike<number>): void {
  for (let i = 0; i < actual.length; i++)
    expect(actual[i]).toBeCloseTo(expected[i]!, 5);
}
describe("math conventions and aliasing", () => {
  // Groups checks for math conventions and aliasing.

  it("supports aliased vector operations and zero normalization", () => {
    // Verifies supports aliased vector operations and zero normalization.

    const a = Vec3.create(1, 0, 0);
    Vec3.cross(a, a, [0, 1, 0]);
    close(a, [0, 0, 1]);
    Vec3.normalize(a, [0, 0, 0]);
    close(a, [0, 0, 0]);
  });
  it("composes TRS with normalized quaternion rotation", () => {
    // Verifies composes TRS with normalized quaternion rotation.

    const q = Quat.create();
    Quat.fromAxisAngle(q, [0, 1, 0], Math.PI / 2);
    const m = Mat4.create();
    Mat4.fromTRS(m, [2, 3, 4], q, [2, 2, 2]);
    close(Mat4.transformPoint(Vec3.create(), m, [1, 0, 0]), [2, 3, 2]);
  });
  it("supports either aliased matrix multiply operand", () => {
    // Verifies supports either aliased matrix multiply operand.

    const a = Mat4.create(),
      b = Mat4.create();
    a[12] = 2;
    b[0] = 3;
    const expected = Mat4.create();
    Mat4.multiply(expected, a, b);
    const aa = a.slice(),
      bb = b.slice();
    Mat4.multiply(aa, aa, b);
    Mat4.multiply(bb, a, bb);
    close(aa, expected);
    close(bb, expected);
  });
  it("maps perspective near/far to WebGPU 0/1 depth", () => {
    // Verifies maps perspective near/far to WebGPU 0/1 depth.

    const m = Mat4.create();
    Mat4.perspective(m, Math.PI / 2, 1, 0.1, 100);
    expect(Mat4.transformPoint(Vec3.create(), m, [0, 0, -0.1])[2]).toBeCloseTo(
      0,
      5,
    );
    expect(Mat4.transformPoint(Vec3.create(), m, [0, 0, -100])[2]).toBeCloseTo(
      1,
      5,
    );
    expect(() =>
      /** Delegates this operation to Mat4.perspective. */ Mat4.perspective(
        m,
        0,
        1,
        0.1,
        100,
      ),
    ).toThrow();
  });
  it("maps the camera eye to origin and its target to negative Z", () => {
    // Verifies maps the camera eye to origin and its target to negative Z.

    const camera = new Camera();
    camera.update(4 / 3);
    close(
      Mat4.transformPoint(Vec3.create(), camera.view, camera.position),
      [0, 0, 0],
    );
    close(Mat4.transformPoint(Vec3.create(), camera.view, camera.target), [
      0,
      0,
      -Math.sqrt(38),
    ]);
    expect(camera.update(4 / 3)).toBe(false);
    camera.setPosition(4, 2, 5);
    expect(camera.update(4 / 3)).toBe(true);
  });
  it("rejects degenerate camera inputs", () => {
    // Verifies rejects degenerate camera inputs.

    expect(() =>
      /** Delegates this operation to Mat4.lookAt. */ Mat4.lookAt(
        Mat4.create(),
        [0, 0, 0],
        [0, 0, 0],
        [0, 1, 0],
      ),
    ).toThrow();
    expect(() =>
      /** Delegates this operation to Mat4.lookAt. */ Mat4.lookAt(
        Mat4.create(),
        [0, 1, 0],
        [0, 0, 0],
        [0, 1, 0],
      ),
    ).toThrow();
  });
  it("slerps the shortest quaternion arc and handles opposite representations", () => {
    // Verifies slerps the shortest quaternion arc and handles opposite representations.

    const a = Quat.create(),
      b = Quat.create(),
      out = Quat.create();
    Quat.fromAxisAngle(b, [0, 1, 0], Math.PI);
    Quat.slerp(out, a, b, 0.5);
    close(out, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    Quat.slerp(out, a, [0, 0, 0, -1], 0.5);
    close(out, a);
  });
});
describe("bounds and WebGPU frustum", () => {
  // Groups checks for bounds and WebGPU frustum.

  it("tests touching and disjoint boxes/spheres", () => {
    // Verifies tests touching and disjoint boxes/spheres.

    const box = new AABB();
    box.expand([-1, -1, -1]);
    box.expand([1, 1, 1]);
    expect(
      box.intersects(new AABB(Vec3.create(1, 1, 1), Vec3.create(2, 2, 2))),
    ).toBe(true);
    expect(
      box.intersects(new AABB(Vec3.create(2, 2, 2), Vec3.create(3, 3, 3))),
    ).toBe(false);
    expect(
      new BoundingSphere(Vec3.create(), 1).intersects(
        new BoundingSphere(Vec3.create(2, 0, 0), 1),
      ),
    ).toBe(true);
    expect(
      new BoundingSphere(Vec3.create(), 1).intersects(
        new BoundingSphere(Vec3.create(3, 0, 0), 1),
      ),
    ).toBe(false);
  });
  it("extracts the near plane from row 2 rather than OpenGL row 3+2", () => {
    // Verifies extracts the near plane from row 2 rather than OpenGL row 3+2.

    const f = new Frustum();
    f.setFromMatrix(Mat4.create());
    expect(
      f.intersectsSphere(new BoundingSphere(Vec3.create(0, 0, 0.5), 0.1)),
    ).toBe(true);
    expect(
      f.intersectsSphere(new BoundingSphere(Vec3.create(0, 0, -0.5), 0.1)),
    ).toBe(false);
    expect(
      f.intersectsSphere(new BoundingSphere(Vec3.create(0, 0, 1.5), 0.1)),
    ).toBe(false);
    expect(
      f.intersectsAABB(
        new AABB(Vec3.create(-0.1, -0.1, 0.2), Vec3.create(0.1, 0.1, 0.8)),
      ),
    ).toBe(true);
    expect(
      f.intersectsAABB(
        new AABB(Vec3.create(2, 0, 0.2), Vec3.create(3, 1, 0.8)),
      ),
    ).toBe(false);
  });
});

it("normalizes quaternion extremes and preserves aliased outputs", () => {
  // Verifies normalizes quaternion extremes and preserves aliased outputs.

  const out = Quat.create();
  for (const magnitude of [0, 1e-300, 1e-160, 1e-30, 1, 1e30, 1e160, 1e300]) {
    const source = [magnitude, -2 * magnitude, 3 * magnitude, -4 * magnitude];
    const length = Math.hypot(...source);
    Quat.normalize(out, source);
    const expected = source.map((component, i) =>
      /** Selects the result according to length === 0. */ length === 0
        ? i === 3
          ? 1
          : 0
        : component / length,
    );
    for (let axis = 0; axis < 4; axis++)
      expect(out[axis]).toBeCloseTo(expected[axis]!, 6);
    expect(Math.hypot(...out)).toBeCloseTo(1, 6);
  }
  out.set([1, 2, 3, 4]);
  const expected = new Float32Array(4);
  Quat.normalize(expected, out);
  Quat.normalize(out, out);
  expect(out).toEqual(expected);
});

it("composes and multiplies packed matrices without views, including exact-range aliases", () => {
  // Verifies composes and multiplies packed matrices without views, including exact-range aliases.

  const packed = new Float32Array(64).fill(123);
  const a = Mat4.create(),
    b = Mat4.create(),
    expected = Mat4.create();
  const q = Quat.create();
  Quat.fromAxisAngle(q, [1, 2, 3], 0.4);
  Mat4.fromTRS(a, [2, 3, 4], q, [-2, 3, 0.5]);
  a[4] = a[4]! + 0.7; // Shear remains valid with the generic 4x4 calculation.
  Mat4.fromTRS(b, [-1, 2, 0], q, [1, 2, 3]);
  Mat4.fromTRS(packed, [-1, 2, 0], q, [1, 2, 3], 32);
  expect(packed.subarray(32, 48)).toEqual(b);
  packed.set(a, 16);
  Mat4.multiply(expected, a, b);
  Mat4.multiply(packed, packed, packed, 0, 16, 32);
  expect(packed.subarray(0, 16)).toEqual(expected);
  Mat4.multiply(packed, packed, packed, 16, 16, 32);
  expect(packed.subarray(16, 32)).toEqual(expected);
  packed.set(a, 16);
  Mat4.multiply(packed, packed, packed, 32, 16, 32);
  expect(packed.subarray(32, 48)).toEqual(expected);
  expect(packed.subarray(48)).toEqual(new Float32Array(16).fill(123));
});

it("slerps packed quaternion keys and supports overlapping output", () => {
  // Verifies slerps packed quaternion keys and supports overlapping output.

  const keys = new Float32Array([9, 9, 0, 0, 0, 1, 0, 0, -1, 0, 9, 9]);
  const expected = Quat.create();
  Quat.slerp(expected, keys.subarray(2, 6), keys.subarray(6, 10), 0.3);
  const actual = Quat.create();
  Quat.slerp(actual, keys, keys, 0.3, 2, 6);
  expect(actual).toEqual(expected);
  Quat.slerp(keys, keys, keys, 0.3, 2, 6);
  expect(keys.subarray(0, 4)).toEqual(expected);
});
