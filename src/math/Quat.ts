const MIN_NORMAL_DOUBLE = 2 ** -1022;
export type Quat = Float32Array;
export const Quat = {
  create: (): Quat => new Float32Array([0, 0, 0, 1]),
  normalize(out: Quat, q: ArrayLike<number>): Quat {
    const x = q[0]!,
      y = q[1]!,
      z = q[2]!,
      w = q[3]!;
    const squared = x * x + y * y + z * z + w * w;
    // Ordinary quaternion components fit safely in squared double precision.
    // Preserve hypot's scaling for extreme ArrayLike inputs that overflow or
    // underflow the sum (including positive subnormals). Zero still becomes identity.
    const length =
      squared >= MIN_NORMAL_DOUBLE && Number.isFinite(squared)
        ? Math.sqrt(squared)
        : Math.hypot(x, y, z, w);
    if (length === 0) {
      out[0] = out[1] = out[2] = 0;
      out[3] = 1;
    } else {
      out[0] = x / length;
      out[1] = y / length;
      out[2] = z / length;
      out[3] = w / length;
    }
    return out;
  },
  fromAxisAngle(out: Quat, axis: ArrayLike<number>, radians: number): Quat {
    const length = Math.hypot(axis[0]!, axis[1]!, axis[2]!);
    if (!length) {
      out.set([0, 0, 0, 1]);
      return out;
    }
    const s = Math.sin(radians / 2) / length;
    for (let i = 0; i < 3; i++) out[i] = axis[i]! * s;
    out[3] = Math.cos(radians / 2);
    return out;
  },
  multiply(out: Quat, a: ArrayLike<number>, b: ArrayLike<number>): Quat {
    const ax = a[0]!,
      ay = a[1]!,
      az = a[2]!,
      aw = a[3]!,
      bx = b[0]!,
      by = b[1]!,
      bz = b[2]!,
      bw = b[3]!;
    out[0] = ax * bw + aw * bx + ay * bz - az * by;
    out[1] = ay * bw + aw * by + az * bx - ax * bz;
    out[2] = az * bw + aw * bz + ax * by - ay * bx;
    out[3] = aw * bw - ax * bx - ay * by - az * bz;
    return out;
  },
  slerp(
    out: Quat,
    a: ArrayLike<number>,
    b: ArrayLike<number>,
    t: number,
  ): Quat {
    let dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
    const sign = dot < 0 ? -1 : 1;
    dot = Math.min(1, Math.abs(dot));
    // Nearly parallel rotations use normalized linear interpolation. Avoid
    // calculating angles that this branch never consumes (common in joint clips).
    let wa = 1 - t,
      wb = t;
    if (dot <= 0.9995) {
      const theta = Math.acos(dot),
        sinTheta = Math.sin(theta);
      wa = Math.sin((1 - t) * theta) / sinTheta;
      wb = Math.sin(t * theta) / sinTheta;
    }
    for (let i = 0; i < 4; i++) out[i] = wa * a[i]! + wb * sign * b[i]!;
    return Quat.normalize(out, out);
  },
};
