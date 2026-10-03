import { AnimationLayer } from "./AnimationPose";

export interface AnimationLayerOptions extends AnimationLayer {
  /** Authored glTF node indices, not ECS entity IDs. Omit to affect every channel. */
  nodes?: readonly number[];
  speed?: number;
  loop?: boolean;
  playing?: boolean;
}
/** Mutable controls belong to a character, never to its shared clip. */
export class AnimationLayerPlayback {
  readonly clip: number;
  readonly mode: "override" | "additive";
  readonly referenceTime: number;
  readonly nodes?: readonly number[];
  loop: boolean;
  playing: boolean;
  private clock: number;
  private amount: number;
  private rate: number;
  constructor(
    options: AnimationLayerOptions,
    private readonly duration: number,
  ) {
    if (
      !Number.isInteger(options.clip) ||
      options.clip < 0 ||
      !["override", "additive"].includes(options.mode) ||
      !Number.isFinite(options.referenceTime ?? 0) ||
      (options.referenceTime ?? 0) < 0 ||
      options.nodes?.some((node) => !Number.isInteger(node) || node < 0)
    )
      throw new Error("Invalid animation layer");
    this.clip = options.clip;
    this.mode = options.mode;
    this.referenceTime = Math.min(options.referenceTime ?? 0, duration);
    this.nodes = options.nodes ? Object.freeze([...options.nodes]) : undefined;
    this.loop = options.loop ?? true;
    this.playing = options.playing ?? true;
    this.clock = 0;
    this.amount = 0;
    this.rate = 1;
    this.time = options.time;
    this.weight = options.weight;
    this.speed = options.speed ?? 1;
  }
  get time(): number {
    return this.clock;
  }
  set time(value: number) {
    if (!Number.isFinite(value)) throw new Error("Invalid layer time");
    this.clock = Math.max(0, Math.min(this.duration, value));
  }
  get weight(): number {
    return this.amount;
  }
  set weight(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error("Invalid layer weight");
    this.amount = value;
  }
  get speed(): number {
    return this.rate;
  }
  set speed(value: number) {
    if (!Number.isFinite(value)) throw new Error("Invalid layer speed");
    this.rate = value;
  }
  advance(delta: number): void {
    if (!this.playing || this.duration === 0) return;
    const next = this.clock + delta * this.rate;
    if (!Number.isFinite(delta) || delta < 0 || !Number.isFinite(next))
      throw new Error("Invalid layer delta");
    this.clock = this.loop
      ? ((next % this.duration) + this.duration) % this.duration
      : Math.max(0, Math.min(this.duration, next));
    if (
      !this.loop &&
      ((this.rate > 0 && this.clock === this.duration) ||
        (this.rate < 0 && this.clock === 0))
    )
      this.playing = false;
  }
}
