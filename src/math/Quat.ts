const MIN_NORMAL_DOUBLE = 2 ** -1022;
export type Quat = Float32Array;
export const Quat = {
  /** Allocates the supplied quaternion, defaulting to identity rotation. */
  create: (): Quat => new Float32Array([0, 0, 0, 1]),
  /** Writes a unit quaternion into caller storage, handling degenerate input safely. */
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
  /** Builds a quaternion from the supplied rotation axis and angle in radians. */
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
  /** Writes the composed quaternion product into caller storage. */
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
  /** Interpolates quaternion rotations along the shortest spherical arc, using a linear fallback near coincidence. */
  slerp(
    out: Quat,
    a: ArrayLike<number>,
    b: ArrayLike<number>,
    t: number,
    aOffset = 0,
    bOffset = 0,
  ): Quat {
    // Cache both endpoints: packed keys need no temporary copies or views,
    // and writes may alias either input after its components have been read.
    const ax = a[aOffset]!,
      ay = a[aOffset + 1]!,
      az = a[aOffset + 2]!,
      aw = a[aOffset + 3]!;
    const bx = b[bOffset]!,
      by = b[bOffset + 1]!,
      bz = b[bOffset + 2]!,
      bw = b[bOffset + 3]!;
    let dot = ax * bx + ay * by + az * bz + aw * bw;
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
    out[0] = wa * ax + wb * sign * bx;
    out[1] = wa * ay + wb * sign * by;
    out[2] = wa * az + wb * sign * bz;
    out[3] = wa * aw + wb * sign * bw;
    return Quat.normalize(out, out);
  },
};
