import { World } from "../ecs/World";
import { AnimationClip } from "./AnimationClip";
import { AnimationChannel, AnimationPath } from "./AnimationChannel";
import { AnimationPose } from "./AnimationPose";
export interface MorphState {
  readonly weightOffset: number;
  readonly targetCount: number;
  readonly weights: Float32Array;
  dirty: boolean;
}
interface Slot {
  path: AnimationPath;
  entity: number;
  morph?: MorphState;
  base: AnimationPose;
  source: AnimationPose;
  target: AnimationPose;
  result: AnimationPose;
}
interface Binding {
  channel: AnimationChannel;
  output: Float32Array;
  slot: Slot;
}
interface Fade {
  from: number;
  time: number;
  elapsed: number;
  duration: number;
}
/** Independent playback; persistent component poses form a seam for future layers. */
export class Animator {
  loop = true;
  speed = 1;
  playing = false;
  clipIndex = 0;
  private time = 0;
  private fade?: Fade;
  private readonly bindings: Binding[][];
  private readonly slots: Slot[] = [];
  constructor(
    readonly clips: readonly AnimationClip[],
    private readonly world: World,
    entities: Int32Array,
    morphs: Map<number, MorphState>,
  ) {
    const slots = new Map<string, Slot>();
    this.bindings = clips.map((clip) =>
      clip.channels.map((channel) => {
        const entity = entities[channel.node] ?? -1,
          morph = morphs.get(entity),
          key = `${channel.node}:${channel.path}`;
        if (
          channel.path === "weights" &&
          entity >= 0 &&
          (!morph || morph.weights.length !== channel.sampler.size)
        )
          throw new Error("Animation morph weight count mismatch");
        let slot = slots.get(key);
        if (!slot) {
          const pose = () =>
            new AnimationPose(channel.path, channel.sampler.size);
          slot = {
            entity,
            morph,
            path: channel.path,
            base: pose(),
            source: pose(),
            target: pose(),
            result: pose(),
          };
          this.readRest(slot, slot.base.values);
          slots.set(key, slot);
          this.slots.push(slot);
        } else if (slot.base.values.length !== channel.sampler.size)
          throw new Error("Animation clip target size mismatch");
        return {
          channel,
          slot,
          output: new Float32Array(channel.sampler.size),
        };
      }),
    );
  }
  get currentTime(): number {
    return this.time;
  }
  get crossfading(): boolean {
    return !!this.fade;
  }
  set currentTime(value: number) {
    if (!Number.isFinite(value)) throw new Error("Invalid animation time");
    this.time = Math.max(
      0,
      Math.min(this.clips[this.clipIndex]?.duration ?? 0, value),
    );
    this.fade = undefined;
    this.apply();
  }
  play(clip = this.clipIndex): void {
    if (!this.clips[clip]) throw new Error("Unknown animation clip");
    if (this.clipIndex !== clip) {
      this.clipIndex = clip;
      this.time = 0;
      this.fade = undefined;
    }
    this.playing = true;
    this.apply();
  }
  pause(): void {
    this.playing = false;
  }
  stop(): void {
    this.playing = false;
    this.time = 0;
    this.fade = undefined;
    this.apply();
  }
  crossFade(clip: number, duration: number): void {
    if (!this.clips[clip] || !Number.isFinite(duration) || duration < 0)
      throw new Error("Invalid crossfade");
    if (duration === 0) {
      this.clipIndex = clip;
      this.time = 0;
      this.fade = undefined;
      this.playing = true;
      this.apply();
      return;
    }
    let from = this.clipIndex;
    if (this.fade) {
      for (const slot of this.slots) this.readRest(slot, slot.source.values);
      from = -1;
    }
    this.fade = { from, time: this.time, elapsed: 0, duration };
    this.clipIndex = clip;
    this.time = 0;
    this.playing = true;
    this.apply();
  }
  update(deltaSeconds: number): void {
    if (
      !Number.isFinite(deltaSeconds) ||
      deltaSeconds < 0 ||
      !Number.isFinite(this.speed)
    )
      throw new Error("Invalid animation delta/speed");
    if (!this.playing) return;
    const duration = this.clips[this.clipIndex]!.duration;
    this.time = this.advance(this.time, duration, deltaSeconds);
    const ended =
      duration === 0 ||
      (!this.loop &&
        ((this.speed > 0 && this.time === duration) ||
          (this.speed < 0 && this.time === 0)));
    if (this.fade) {
      if (this.fade.from >= 0)
        this.fade.time = this.advance(
          this.fade.time,
          this.clips[this.fade.from]!.duration,
          deltaSeconds,
        );
      this.fade.elapsed = Math.min(
        this.fade.duration,
        this.fade.elapsed + deltaSeconds,
      );
      this.apply();
      if (this.fade.elapsed === this.fade.duration) {
        this.fade = undefined;
        if (ended) this.playing = false;
      }
    } else {
      if (ended) this.playing = false;
      this.apply();
    }
  }
  private advance(time: number, duration: number, delta: number): number {
    if (duration === 0) return 0;
    const next = time + delta * this.speed;
    return this.loop
      ? ((next % duration) + duration) % duration
      : Math.max(0, Math.min(duration, next));
  }
  private readRest(slot: Slot, out: Float32Array): void {
    const e = slot.entity,
      t = this.world.transforms;
    if (slot.path === "weights") {
      if (slot.morph) out.set(slot.morph.weights);
      return;
    }
    if (e < 0) {
      if (slot.path === "rotation") out[3] = 1;
      else if (slot.path === "scale") out.fill(1);
      return;
    }
    switch (slot.path) {
      case "translation":
        out[0] = t.positionX[e]!;
        out[1] = t.positionY[e]!;
        out[2] = t.positionZ[e]!;
        break;
      case "rotation":
        out[0] = t.rotationX[e]!;
        out[1] = t.rotationY[e]!;
        out[2] = t.rotationZ[e]!;
        out[3] = t.rotationW[e]!;
        break;
      case "scale":
        out[0] = t.scaleX[e]!;
        out[1] = t.scaleY[e]!;
        out[2] = t.scaleZ[e]!;
        break;
    }
  }
  private apply(): void {
    if (!this.fade) {
      const bindings = this.bindings[this.clipIndex];
      if (!bindings) return;
      for (const b of bindings) {
        b.channel.sampler.sample(this.time, b.output);
        this.write(b.slot, b.output);
      }
      return;
    }
    for (const slot of this.slots) {
      if (this.fade.from >= 0) slot.source.copy(slot.base.values);
      slot.target.copy(slot.base.values);
    }
    if (this.fade.from >= 0)
      for (const b of this.bindings[this.fade.from]!) {
        b.channel.sampler.sample(this.fade.time, b.output);
        b.slot.source.copy(b.output);
      }
    for (const b of this.bindings[this.clipIndex]!) {
      b.channel.sampler.sample(this.time, b.output);
      b.slot.target.copy(b.output);
    }
    const weight = this.fade.elapsed / this.fade.duration;
    for (const slot of this.slots) {
      slot.result.copy(slot.source.values);
      slot.result.blend(slot.target, weight);
      this.write(slot, slot.result.values);
    }
  }
  private write(slot: Slot, v: Float32Array): void {
    const e = slot.entity,
      t = this.world.transforms;
    if (e < 0 || !this.world.alive[e] || !t.has[e]) return;
    switch (slot.path) {
      case "translation":
        if (
          t.positionX[e] !== v[0] ||
          t.positionY[e] !== v[1] ||
          t.positionZ[e] !== v[2]
        )
          t.setPosition(e, v[0]!, v[1]!, v[2]!);
        break;
      case "scale":
        if (
          t.scaleX[e] !== v[0] ||
          t.scaleY[e] !== v[1] ||
          t.scaleZ[e] !== v[2]
        )
          t.setScale(e, v[0]!, v[1]!, v[2]!);
        break;
      case "rotation":
        if (
          t.rotationX[e] !== v[0] ||
          t.rotationY[e] !== v[1] ||
          t.rotationZ[e] !== v[2] ||
          t.rotationW[e] !== v[3]
        )
          t.setRotation(e, v[0]!, v[1]!, v[2]!, v[3]!);
        break;
      case "weights":
        if (slot.morph)
          for (let i = 0; i < v.length; i++)
            if (slot.morph.weights[i] !== v[i]) {
              slot.morph.weights[i] = v[i]!;
              slot.morph.dirty = true;
            }
        break;
    }
  }
}
