import { Quat } from "../math/Quat";
export type Interpolation = "STEP" | "LINEAR" | "CUBICSPLINE";
/** Immutable clip data; callers supply persistent output storage. */
export class AnimationSampler {
  readonly size: number;
  readonly duration: number;
  private readonly rotationKeys?: Float32Array;
  private readonly a = new Float32Array(4);
  constructor(
    readonly input: Float32Array,
    readonly output: Float32Array,
    readonly interpolation: Interpolation,
    readonly rotation = false,
  ) {
    if (
      !["STEP", "LINEAR", "CUBICSPLINE"].includes(interpolation) ||
      !input.length
    )
      throw new Error("Invalid animation sampler");
    for (let i = 0; i < input.length; i++)
      if (
        !Number.isFinite(input[i]) ||
        input[i]! < 0 ||
        (i > 0 && input[i]! <= input[i - 1]!)
      )
        throw new Error("Animation times must increase");
    this.size =
      output.length /
      (input.length * (interpolation === "CUBICSPLINE" ? 3 : 1));
    if (
      !Number.isInteger(this.size) ||
      this.size < 1 ||
      (rotation && this.size !== 4)
    )
      throw new Error("Invalid animation output size");
    for (const value of output)
      if (!Number.isFinite(value)) throw new Error("Invalid animation output");
    this.duration = input[input.length - 1]!;
    if (rotation && interpolation === "LINEAR") {
      // Clips are immutable and shared between instances. Normalize keyframes
      // once at decode instead of repeating two normalizations for every joint.
      // Keep f32 rounding identical to the original per-sample scratch arrays.
      this.rotationKeys = new Float32Array(output.length);
      for (let offset = 0; offset < output.length; offset += 4) {
        for (let axis = 0; axis < 4; axis++)
          this.a[axis] = output[offset + axis]!;
        Quat.normalize(this.a, this.a);
        this.rotationKeys.set(this.a, offset);
      }
    }
  }
  sample(time: number, out: Float32Array): void {
    if (!Number.isFinite(time) || out.length < this.size)
      throw new Error("Invalid animation sample");
    const times = this.input,
      values = this.output,
      size = this.size;
    let lo = 0,
      hi = times.length - 1;
    if (time <= times[0]!) hi = lo;
    else if (time >= times[hi]!) lo = hi;
    else {
      while (hi - lo > 1) {
        const mid = (lo + hi) >>> 1;
        if (times[mid]! <= time) lo = mid;
        else hi = mid;
      }
    }
    const cubic = this.interpolation === "CUBICSPLINE",
      stride = size * (cubic ? 3 : 1),
      a = lo * stride + (cubic ? size : 0),
      b = hi * stride + (cubic ? size : 0);
    if (lo === hi || this.interpolation === "STEP") {
      for (let i = 0; i < size; i++) out[i] = values[a + i]!;
    } else {
      const dt = times[hi]! - times[lo]!,
        t = (time - times[lo]!) / dt;
      if (cubic) {
        const t2 = t * t,
          t3 = t2 * t;
        for (let i = 0; i < size; i++)
          out[i] =
            (2 * t3 - 3 * t2 + 1) * values[a + i]! +
            (t3 - 2 * t2 + t) * dt * values[a + size + i]! +
            (-2 * t3 + 3 * t2) * values[b + i]! +
            (t3 - t2) * dt * values[b - size + i]!;
      } else if (this.rotation) {
        const keys = this.rotationKeys!;
        // Read normalized keys directly; do not copy eight components per joint.
        Quat.slerp(out, keys, keys, t, a, b);
      } else
        for (let i = 0; i < size; i++)
          out[i] = values[a + i]! * (1 - t) + values[b + i]! * t;
    }
    if (this.rotation) Quat.normalize(out, out);
  }
}
