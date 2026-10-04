import { AnimationClip } from "./AnimationClip";
import { AnimationSampler } from "./AnimationSampler";
/** Packed rigid pose: xyz translation, xyzw rotation. No per-sample allocations. */
function compose(out: Float32Array, a: Float32Array, b: Float32Array): void {
  const x = b[0]!,
    y = b[1]!,
    z = b[2]!,
    qx = a[3]!,
    qy = a[4]!,
    qz = a[5]!,
    qw = a[6]!;
  const tx = 2 * (qy * z - qz * y),
    ty = 2 * (qz * x - qx * z),
    tz = 2 * (qx * y - qy * x);
  const px = a[0]! + x + qw * tx + (qy * tz - qz * ty),
    py = a[1]! + y + qw * ty + (qz * tx - qx * tz),
    pz = a[2]! + z + qw * tz + (qx * ty - qy * tx);
  const bx = b[3]!,
    by = b[4]!,
    bz = b[5]!,
    bw = b[6]!;
  const rx = qx * bw + qw * bx + qy * bz - qz * by,
    ry = qy * bw + qw * by + qz * bx - qx * bz,
    rz = qz * bw + qw * bz + qx * by - qy * bx,
    rw = qw * bw - qx * bx - qy * by - qz * bz;
  const length = Math.hypot(rx, ry, rz, rw);
  out[0] = px;
  out[1] = py;
  out[2] = pz;
  out[3] = rx / length;
  out[4] = ry / length;
  out[5] = rz / length;
  out[6] = rw / length;
}
/** Writes a no-translation identity root rotation into caller-owned pose storage. */
function identity(out: Float32Array): void {
  out.fill(0);
  out[6] = 1;
}
/** Inverts a rigid root pose into caller-owned scratch for relative root-motion composition. */
function inverse(
  out: Float32Array,
  pose: Float32Array,
  scratch: Float32Array,
): void {
  const x = pose[0]!,
    y = pose[1]!,
    z = pose[2]!;
  scratch.set(pose);
  scratch[3] = -pose[3]!;
  scratch[4] = -pose[4]!;
  scratch[5] = -pose[5]!;
  scratch[0] = scratch[1] = scratch[2] = 0;
  identity(out);
  out[0] = -x;
  out[1] = -y;
  out[2] = -z;
  compose(out, scratch, out);
}
/** Pure extraction for authoritative fixed-step gameplay, including reverse playback and loop seams.
 * Caller owns unwrapped clocks and applies the delta to an actor. Use in-place visual playback. */
export class RootMotionSampler {
  private readonly translation?: AnimationSampler;
  private readonly rotation?: AnimationSampler;
  private readonly origin = new Float32Array(7);
  private readonly inverseOrigin = new Float32Array(7);
  private readonly cycle = new Float32Array(7);
  private readonly a = new Float32Array(7);
  private readonly b = new Float32Array(7);
  private readonly temporary = new Float32Array(7);
  private readonly raw = new Float32Array(7);
  private readonly power = new Float32Array(7);
  private readonly factor = new Float32Array(7);
  private readonly sampleTranslation = new Float32Array(3);
  private readonly sampleRotation = new Float32Array(4);
  /** Initializes mesh-independent root-transform sampling scratch; invalid input is rejected. */
  constructor(
    readonly clip: AnimationClip,
    readonly node: number,
  ) {
    if (!Number.isInteger(node) || node < 0)
      throw new Error("Invalid root-motion node");
    this.translation = clip.channels.find(
      (channel) =>
        /** Evaluates the channel.node === node && channel.path === "translation" condition. */ channel.node ===
          node && channel.path === "translation",
    )?.sampler;
    this.rotation = clip.channels.find(
      (channel) =>
        /** Evaluates the channel.node === node && channel.path === "rotation" condition. */ channel.node ===
          node && channel.path === "rotation",
    )?.sampler;
    if (!this.translation && !this.rotation)
      throw new Error("Root-motion node has no motion channels");
    this.sampleRaw(0, this.origin);
    inverse(this.inverseOrigin, this.origin, this.temporary);
    this.sampleRaw(clip.duration, this.raw);
    compose(this.cycle, this.inverseOrigin, this.raw);
  }
  /** Samples root translation/rotation channels at a clip-local time into reusable scratch. */
  private sampleRaw(time: number, out: Float32Array): void {
    identity(out);
    if (this.translation) {
      this.translation.sample(time, this.sampleTranslation);
      out.set(this.sampleTranslation, 0);
    }
    if (this.rotation) {
      this.rotation.sample(time, this.sampleRotation);
      out.set(this.sampleRotation, 3);
    }
  }
  /** Evaluates the root transform for an arbitrary playback time with loop displacement included. */
  private pose(time: number, loop: boolean, out: Float32Array): void {
    const duration = this.clip.duration;
    let cycles = loop && duration > 0 ? Math.floor(time / duration) : 0;
    if (Math.abs(cycles) > 1e6)
      throw new RangeError("Root-motion loop count exceeded");
    const local =
      loop && duration > 0
        ? time - cycles * duration
        : Math.max(0, Math.min(duration, time));
    this.sampleRaw(local, this.raw);
    compose(out, this.inverseOrigin, this.raw);
    identity(this.power);
    this.factor.set(this.cycle);
    if (cycles < 0) {
      inverse(this.factor, this.cycle, this.temporary);
      cycles = -cycles;
    }
    // Exponentiation bounds work even when a timestep crosses many cycles.
    while (cycles > 0) {
      if (cycles % 2 === 1) compose(this.power, this.power, this.factor);
      compose(this.factor, this.factor, this.factor);
      cycles = Math.floor(cycles / 2);
    }
    compose(out, this.power, out);
  }
  /** Writes local translation + quaternion into caller-owned seven-float output. */
  delta(from: number, to: number, out: Float32Array, loop = true): void {
    if (!Number.isFinite(from) || !Number.isFinite(to) || out.length < 7)
      throw new Error("Invalid root-motion sample");
    this.pose(from, loop, this.a);
    this.pose(to, loop, this.b);
    inverse(this.a, this.a, this.temporary);
    compose(out, this.a, this.b);
  }
}
