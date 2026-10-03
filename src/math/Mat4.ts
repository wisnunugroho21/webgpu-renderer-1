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
  multiply(
    out: Mat4,
    a: ArrayLike<number>,
    b: ArrayLike<number>,
    outOffset = 0,
    aOffset = 0,
    bOffset = 0,
  ): Mat4 {
    // Offsets address packed matrices without allocating typed-array views.
    // Cache A for in-place output. B may alias the identical output range;
    // partially overlapping B/output ranges are not supported.
    const a00 = a[aOffset + 0]!,
      a01 = a[aOffset + 1]!,
      a02 = a[aOffset + 2]!,
      a03 = a[aOffset + 3]!,
      a10 = a[aOffset + 4]!,
      a11 = a[aOffset + 5]!,
      a12 = a[aOffset + 6]!,
      a13 = a[aOffset + 7]!,
      a20 = a[aOffset + 8]!,
      a21 = a[aOffset + 9]!,
      a22 = a[aOffset + 10]!,
      a23 = a[aOffset + 11]!,
      a30 = a[aOffset + 12]!,
      a31 = a[aOffset + 13]!,
      a32 = a[aOffset + 14]!,
      a33 = a[aOffset + 15]!;
    for (let c = 0; c < 4; c++) {
      const source = bOffset + c * 4,
        destination = outOffset + c * 4;
      const x = b[source]!,
        y = b[source + 1]!,
        z = b[source + 2]!,
        w = b[source + 3]!;
      out[destination] = a00 * x + a10 * y + a20 * z + a30 * w;
      out[destination + 1] = a01 * x + a11 * y + a21 * z + a31 * w;
      out[destination + 2] = a02 * x + a12 * y + a22 * z + a32 * w;
      out[destination + 3] = a03 * x + a13 * y + a23 * z + a33 * w;
    }
    return out;
  },
  invert(out: Mat4, a: ArrayLike<number>): Mat4 {
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
    const b00 = a00 * a11 - a01 * a10,
      b01 = a00 * a12 - a02 * a10,
      b02 = a00 * a13 - a03 * a10,
      b03 = a01 * a12 - a02 * a11,
      b04 = a01 * a13 - a03 * a11,
      b05 = a02 * a13 - a03 * a12,
      b06 = a20 * a31 - a21 * a30,
      b07 = a20 * a32 - a22 * a30,
      b08 = a20 * a33 - a23 * a30,
      b09 = a21 * a32 - a22 * a31,
      b10 = a21 * a33 - a23 * a31,
      b11 = a22 * a33 - a23 * a32;
    const determinant =
      b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (determinant === 0 || !Number.isFinite(determinant))
      throw new Error("Singular matrix");
    const d = 1 / determinant;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
    return out;
  },
  orthographic(
    out: Mat4,
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
  ): Mat4 {
    if (!(right > left && top > bottom && near >= 0 && far > near))
      throw new Error("Invalid orthographic parameters");
    out.fill(0);
    out[0] = 2 / (right - left);
    out[5] = 2 / (top - bottom);
    out[10] = 1 / (near - far);
    out[12] = (left + right) / (left - right);
    out[13] = (bottom + top) / (bottom - top);
    out[14] = near / (near - far);
    out[15] = 1;
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
    outOffset = 0,
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
    out[outOffset + 0] = (1 - 2 * (yy + zz)) * s[0]!;
    out[outOffset + 1] = 2 * (xy + wz) * s[0]!;
    out[outOffset + 2] = 2 * (xz - wy) * s[0]!;
    out[outOffset + 3] = 0;
    out[outOffset + 4] = 2 * (xy - wz) * s[1]!;
    out[outOffset + 5] = (1 - 2 * (xx + zz)) * s[1]!;
    out[outOffset + 6] = 2 * (yz + wx) * s[1]!;
    out[outOffset + 7] = 0;
    out[outOffset + 8] = 2 * (xz + wy) * s[2]!;
    out[outOffset + 9] = 2 * (yz - wx) * s[2]!;
    out[outOffset + 10] = (1 - 2 * (xx + yy)) * s[2]!;
    out[outOffset + 11] = 0;
    out[outOffset + 12] = p[0]!;
    out[outOffset + 13] = p[1]!;
    out[outOffset + 14] = p[2]!;
    out[outOffset + 15] = 1;
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
