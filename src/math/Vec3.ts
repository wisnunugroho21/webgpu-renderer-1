export type Vec3 = Float32Array;
export const Vec3 = {
  create: (x = 0, y = 0, z = 0): Vec3 => new Float32Array([x, y, z]),
  set(out: Vec3, x: number, y: number, z: number): Vec3 {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  },
  subtract(out: Vec3, a: ArrayLike<number>, b: ArrayLike<number>): Vec3 {
    for (let i = 0; i < 3; i++) out[i] = a[i]! - b[i]!;
    return out;
  },
  cross(out: Vec3, a: ArrayLike<number>, b: ArrayLike<number>): Vec3 {
    const x = a[1]! * b[2]! - a[2]! * b[1]!,
      y = a[2]! * b[0]! - a[0]! * b[2]!,
      z = a[0]! * b[1]! - a[1]! * b[0]!;
    return Vec3.set(out, x, y, z);
  },
  dot: (a: ArrayLike<number>, b: ArrayLike<number>): number =>
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!,
  normalize(out: Vec3, a: ArrayLike<number>): Vec3 {
    const length = Math.hypot(a[0]!, a[1]!, a[2]!);
    return length === 0
      ? Vec3.set(out, 0, 0, 0)
      : Vec3.set(out, a[0]! / length, a[1]! / length, a[2]! / length);
  },
};
