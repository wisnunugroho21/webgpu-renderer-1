export type Mat4 = Float32Array;
/** Column-major matrices, column vectors, right-handed coordinates, standard WebGPU Z [0,1]. */
export const Mat4 = {
  create(): Mat4 {
    return Mat4.identity(new Float32Array(16));
  },
  identity(out: Mat4): Mat4 {
    out.fill(0);
    out[0] = out[5] = out[10] = out[15] = 1;
    return out;
  },
  multiply(out: Mat4, a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
    // Cache A so multiplication supports in-place output for either operand.
    const a00 = a[0]!,
      a01 = a[1]!,
      a02 = a[2]!,
      a03 = a[3]!,
      a10 = a[4]!,
      a11 = a[5]!,
      a12 = a[6]!,
      a13 = a[7]!,
      a20 = a[8]!,
      a21 = a[9]!,
      a22 = a[10]!,
      a23 = a[11]!,
      a30 = a[12]!,
      a31 = a[13]!,
      a32 = a[14]!,
      a33 = a[15]!;
    for (let c = 0; c < 4; c++) {
      const x = b[c * 4]!,
        y = b[c * 4 + 1]!,
        z = b[c * 4 + 2]!,
        w = b[c * 4 + 3]!;
      out[c * 4] = a00 * x + a10 * y + a20 * z + a30 * w;
      out[c * 4 + 1] = a01 * x + a11 * y + a21 * z + a31 * w;
      out[c * 4 + 2] = a02 * x + a12 * y + a22 * z + a32 * w;
      out[c * 4 + 3] = a03 * x + a13 * y + a23 * z + a33 * w;
    }
    return out;
  },
  perspective(
    out: Mat4,
    fovY: number,
    aspect: number,
    near: number,
    far: number,
  ): Mat4 {
    if (!(fovY > 0 && fovY < Math.PI && aspect > 0 && near > 0 && far > near))
      throw new Error("Invalid perspective parameters");
    out.fill(0);
    const f = 1 / Math.tan(fovY / 2);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = far / (near - far);
    out[11] = -1;
    out[14] = (near * far) / (near - far);
    return out;
  },
  lookAt(
    out: Mat4,
    eye: ArrayLike<number>,
    target: ArrayLike<number>,
    up: ArrayLike<number>,
  ): Mat4 {
    let zx = eye[0]! - target[0]!,
      zy = eye[1]! - target[1]!,
      zz = eye[2]! - target[2]!;
    const zl = Math.hypot(zx, zy, zz);
    if (!zl) throw new Error("Camera eye equals target");
    zx /= zl;
    zy /= zl;
    zz /= zl;
    let xx = up[1]! * zz - up[2]! * zy,
      xy = up[2]! * zx - up[0]! * zz,
      xz = up[0]! * zy - up[1]! * zx;
    const xl = Math.hypot(xx, xy, xz);
    if (xl < 1e-8) throw new Error("Camera up is parallel to direction");
    xx /= xl;
    xy /= xl;
    xz /= xl;
    const yx = zy * xz - zz * xy,
      yy = zz * xx - zx * xz,
      yz = zx * xy - zy * xx;
    out[0] = xx;
    out[1] = yx;
    out[2] = zx;
    out[3] = 0;
    out[4] = xy;
    out[5] = yy;
    out[6] = zy;
    out[7] = 0;
    out[8] = xz;
    out[9] = yz;
    out[10] = zz;
    out[11] = 0;
    out[12] = -(xx * eye[0]! + xy * eye[1]! + xz * eye[2]!);
    out[13] = -(yx * eye[0]! + yy * eye[1]! + yz * eye[2]!);
    out[14] = -(zx * eye[0]! + zy * eye[1]! + zz * eye[2]!);
    out[15] = 1;
    return out;
  },
  fromTRS(
    out: Mat4,
    p: ArrayLike<number>,
    q: ArrayLike<number>,
    s: ArrayLike<number>,
  ): Mat4 {
    const x = q[0]!,
      y = q[1]!,
      z = q[2]!,
      w = q[3]!,
      xx = x * x,
      yy = y * y,
      zz = z * z,
      xy = x * y,
      xz = x * z,
      yz = y * z,
      wx = w * x,
      wy = w * y,
      wz = w * z;
    out[0] = (1 - 2 * (yy + zz)) * s[0]!;
    out[1] = 2 * (xy + wz) * s[0]!;
    out[2] = 2 * (xz - wy) * s[0]!;
    out[3] = 0;
    out[4] = 2 * (xy - wz) * s[1]!;
    out[5] = (1 - 2 * (xx + zz)) * s[1]!;
    out[6] = 2 * (yz + wx) * s[1]!;
    out[7] = 0;
    out[8] = 2 * (xz + wy) * s[2]!;
    out[9] = 2 * (yz - wx) * s[2]!;
    out[10] = (1 - 2 * (xx + yy)) * s[2]!;
    out[11] = 0;
    out[12] = p[0]!;
    out[13] = p[1]!;
    out[14] = p[2]!;
    out[15] = 1;
    return out;
  },
  transformPoint(
    out: Float32Array,
    m: ArrayLike<number>,
    p: ArrayLike<number>,
  ): Float32Array {
    const x = p[0]!,
      y = p[1]!,
      z = p[2]!,
      w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    out[0] = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w;
    out[1] = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w;
    out[2] = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w;
    return out;
  },
};
