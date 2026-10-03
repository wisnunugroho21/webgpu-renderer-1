export type Quat = Float32Array;
export const Quat = {
  create: (): Quat => new Float32Array([0, 0, 0, 1]),
  normalize(out: Quat, q: ArrayLike<number>): Quat {
    const length = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
    for (let i = 0; i < 4; i++)
      out[i] = length === 0 ? (i === 3 ? 1 : 0) : q[i]! / length;
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
  slerp(
    out: Quat,
    a: ArrayLike<number>,
    b: ArrayLike<number>,
    t: number,
  ): Quat {
    let dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
    const sign = dot < 0 ? -1 : 1;
    dot = Math.min(1, Math.abs(dot));
    const theta = Math.acos(dot),
      sinTheta = Math.sin(theta);
    const wa = dot > 0.9995 ? 1 - t : Math.sin((1 - t) * theta) / sinTheta;
    const wb = dot > 0.9995 ? t : Math.sin(t * theta) / sinTheta;
    for (let i = 0; i < 4; i++) out[i] = wa * a[i]! + wb * sign * b[i]!;
    return Quat.normalize(out, out);
  },
};
