import {
  createAnimationLayer,
  type MorphState,
  type AnimationSlot,
  type AnimationBinding,
  type AnimationLayerState,
} from "./AnimationBindings";
export type { MorphState } from "./AnimationBindings";
import {
  AnimationEvents,
  AnimationMarker,
  AnimationEventListener,
} from "./AnimationEvents";
import { World } from "../ecs/World";
import { AnimationPose } from "./AnimationPose";
import { AnimationClip } from "./AnimationClip";
import {
  AnimationLayerOptions,
  AnimationLayerPlayback,
} from "./AnimationLayerPlayback";
interface Fade {
  from: number;
  time: number;
  elapsed: number;
  duration: number;
}
/** Independent playback; persistent component poses form a seam for future layers. */
export class Animator {
  /** Manual mode lets authoritative fixed ticks advance this controller exactly once. */
  updateMode: "automatic" | "manual" = "automatic";
  loop = true;
  speed = 1;
  playing = false;
  clipIndex = 0;
  private events?: AnimationEvents;
  private inPlaceNode: number | null = null;
  private time = 0;
  private interval = 0;
  private phase = 0;
  private pendingEvaluation = 0;
  /** Diagnostics count pose evaluations rather than clock advances. */
  evaluations = 0;
  /** Explicit quality control: zero evaluates every frame; clocks always advance. */
  get evaluationInterval(): number {
    return this.interval;
  }
  /** Validates the pose-evaluation interval while clock/event advancement remains independent. */
  set evaluationInterval(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1)
      throw new RangeError(
        "Animation evaluation interval must be between 0 and 1 second",
      );
    this.interval = seconds;
    this.pendingEvaluation = this.phase * this.interval;
  }
  /** Stagger crowds across the sampling interval; fraction is in [0, 1). */
  get evaluationPhase(): number {
    return this.phase;
  }
  /** Validates the frame phase used to stagger pose sampling across characters. */
  set evaluationPhase(value: number) {
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new RangeError("Animation evaluation phase must be in [0, 1)");
    this.phase = value;
    this.pendingEvaluation = value * this.interval;
  }
  /** Determines whether this controller pose is sampled on the current staggered evaluation cadence. */
  private evaluateFrame(delta: number, force: boolean): void {
    this.pendingEvaluation += delta;
    if (
      this.interval === 0 ||
      force ||
      this.pendingEvaluation + 1e-10 >= this.interval
    ) {
      this.pendingEvaluation =
        this.interval > 0 ? this.pendingEvaluation % this.interval : 0;
      this.apply();
    }
  }
  private layerStates: AnimationLayerState[] = [];
  private layerControls: readonly AnimationLayerPlayback[] = Object.freeze([]);
  private fade?: Fade;
  private readonly bindings: AnimationBinding[][];
  // Preserve construction and stable arrays used by the sampling loop. Layer setup lives separately.
  private readonly slots: AnimationSlot[] = [];
  /** Initializes one character playback clock, bindings, crossfade poses and layer state; invalid input is rejected. */
  constructor(
    readonly clips: readonly AnimationClip[],
    private readonly world: World,
    entities: Int32Array,
    morphs: Map<number, MorphState>,
  ) {
    const slots = new Map<string, AnimationSlot>();
    this.bindings = clips.map((clip) =>
      /** Builds an output entry for each input item. */ clip.channels.map(
        (channel) => {
          // Builds a record containing channel, key index, slot, output.

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
            /** Creates AnimationPose storage for this operation. */
            const pose = () =>
              new AnimationPose(channel.path, channel.sampler.size);
            slot = {
              entity,
              node: channel.node,
              generation: world.generation[entity] ?? -1,
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
            keyIndex: 0,
            slot,
            output: new Float32Array(channel.sampler.size),
          };
        },
      ),
    );
  }
  /** Events belong to this controller; source clips in a crossfade do not emit duplicates. */
  setEvents(clip: number, markers: readonly AnimationMarker[]): void {
    (this.events ??= new AnimationEvents(this.clips)).set(clip, markers);
  }
  /** Subscribes to clip markers and returns the listener removal function. */
  onEvent(listener: AnimationEventListener): () => void {
    return (this.events ??= new AnimationEvents(this.clips)).on(listener);
  }
  /** Remove root translation/rotation from visual playback when gameplay extracts it separately. */
  setInPlaceRoot(node: number | null): void {
    if (
      node !== null &&
      !this.slots.some(
        (slot) =>
          /** Evaluates the slot.node === node condition. */ slot.node === node,
      )
    )
      throw new Error("Unknown in-place animation root");
    this.inPlaceNode = node;
    this.apply();
  }
  /** Sample current base/layer clocks without advancing, including while paused. */
  evaluate(): void {
    this.pendingEvaluation = 0;
    this.apply();
  }
  /** Returns the retained layer playback controls without exposing internal binding state. */
  get layers(): readonly AnimationLayerPlayback[] {
    return this.layerControls;
  }
  /** Cold setup: resolve node masks and allocate persistent poses once. */
  addLayer(options: AnimationLayerOptions): AnimationLayerPlayback {
    const state = createAnimationLayer(
      options,
      this.clips,
      this.bindings,
      this.slots,
    );
    const { playback } = state;
    this.layerStates.push(state);
    this.layerControls = Object.freeze(
      this.layerStates.map(
        (state) => /** Returns state playback. */ state.playback,
      ),
    );
    this.apply();
    return playback;
  }
  /** Removes the requested layer and recomposes the current pose so its contribution disappears immediately. */
  removeLayer(playback: AnimationLayerPlayback): boolean {
    const index = this.layerStates.findIndex(
      (state) =>
        /** Evaluates the state.playback === playback condition. */ state.playback ===
        playback,
    );
    if (index < 0) return false;
    this.layerStates.splice(index, 1);
    this.layerControls = Object.freeze(
      this.layerStates.map(
        (state) => /** Returns state playback. */ state.playback,
      ),
    );
    this.apply(true);
    return true;
  }
  /** Drops all layer controls and recomposes the unlayered base pose. */
  clearLayers(): void {
    if (!this.layerStates.length) return;
    this.layerStates = [];
    this.layerControls = Object.freeze([]);
    this.apply(true);
  }
  /** Returns the current clip playback time in seconds. */
  get currentTime(): number {
    return this.time;
  }
  /** Reports whether an active crossfade blends the source pose into the current clip. */
  get crossfading(): boolean {
    return !!this.fade;
  }
  /** Clamps a finite seek to the clip duration, cancels a crossfade and immediately resamples the pose. */
  set currentTime(value: number) {
    if (!Number.isFinite(value)) throw new Error("Invalid animation time");
    this.time = Math.max(
      0,
      Math.min(this.clips[this.clipIndex]?.duration ?? 0, value),
    );
    this.fade = undefined;
    this.apply();
  }
  /** Validates the clip, resets time when changing clips, enables playback and applies the current pose. */
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
  /** Stops clock advancement while retaining the current sampled pose. */
  pause(): void {
    this.playing = false;
  }
  /** Stops playback, clears a pending crossfade and reapplies the clip start pose. */
  stop(): void {
    this.playing = false;
    this.time = 0;
    for (const layer of this.layerStates) layer.playback.time = 0;
    this.fade = undefined;
    this.apply();
  }
  /** Starts a bounded-duration transition using retained source/destination poses, including interrupted fades. */
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
      for (const slot of this.slots)
        if (this.layerStates.length) slot.source.copy(slot.result.values);
        else this.readRest(slot, slot.source.values);
      from = -1;
    }
    this.fade = { from, time: this.time, elapsed: 0, duration };
    this.clipIndex = clip;
    this.time = 0;
    this.playing = true;
    this.apply();
  }
  /** Advances clocks/events and evaluates the current pose according to the configured sampling cadence. */
  update(deltaSeconds: number): void {
    if (
      !Number.isFinite(deltaSeconds) ||
      deltaSeconds < 0 ||
      !Number.isFinite(this.speed)
    )
      throw new Error("Invalid animation delta/speed");
    if (!this.playing) return;
    const previousTime = this.time,
      eventClip = this.clipIndex;
    for (const layer of this.layerStates) layer.playback.advance(deltaSeconds);
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
      if (this.interval === 0) this.apply();
      else
        this.evaluateFrame(
          deltaSeconds,
          ended || this.fade.elapsed === this.fade.duration,
        );
      if (this.fade.elapsed === this.fade.duration) {
        this.fade = undefined;
        if (ended) this.playing = false;
      }
    } else {
      if (ended) this.playing = false;
      if (this.interval === 0) this.apply();
      else this.evaluateFrame(deltaSeconds, ended);
    }
    this.events?.advance(
      eventClip,
      previousTime,
      deltaSeconds * this.speed,
      this.loop,
    );
  }
  /** Advances a clip clock using playback speed, wrapping or clamping at clip boundaries. */
  private advance(time: number, duration: number, delta: number): number {
    if (duration === 0) return 0;
    const next = time + delta * this.speed;
    return this.loop
      ? ((next % duration) + duration) % duration
      : Math.max(0, Math.min(duration, next));
  }
  /** Copies bound nodes and morph weights into the reusable rest-pose storage. */
  private readRest(slot: AnimationSlot, out: Float32Array): void {
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
  /** Samples and blends the base pose, composes layers and writes the resulting ECS state. */
  private apply(restoreRest = false): void {
    this.evaluations++;
    if (!this.fade && !this.layerStates.length && !restoreRest) {
      const bindings = this.bindings[this.clipIndex];
      if (!bindings) return;
      for (const b of bindings) {
        this.sample(b, this.time);
        this.write(b.slot, b.output);
      }
      return;
    }
    if (!this.fade) {
      for (const slot of this.slots) slot.result.copy(slot.base.values);
      for (const binding of this.bindings[this.clipIndex] ?? []) {
        this.sample(binding, this.time);
        binding.slot.result.copy(binding.output);
      }
      this.applyLayers();
      return;
    }
    for (const slot of this.slots) {
      if (this.fade.from >= 0) slot.source.copy(slot.base.values);
      slot.target.copy(slot.base.values);
    }
    if (this.fade.from >= 0)
      for (const b of this.bindings[this.fade.from]!) {
        this.sample(b, this.fade.time);
        b.slot.source.copy(b.output);
      }
    for (const b of this.bindings[this.clipIndex]!) {
      this.sample(b, this.time);
      b.slot.target.copy(b.output);
    }
    const weight = this.fade.elapsed / this.fade.duration;
    for (const slot of this.slots) {
      slot.result.copy(slot.source.values);
      slot.result.blend(slot.target, weight);
    }
    this.applyLayers();
  }
  /** Composes enabled override/additive layers using masks and independent clocks without accumulating prior frame deltas. */
  private applyLayers(): void {
    if (!this.layerStates.length) {
      for (const slot of this.slots) this.write(slot, slot.result.values);
      return;
    }
    for (const slot of this.slots) slot.layered!.copy(slot.result.values);
    // Ordered component-space composition; absent/masked channels do nothing.
    for (const layer of this.layerStates) {
      const control = layer.playback;
      if (control.weight === 0) continue;
      for (const binding of layer.bindings) {
        this.sample(binding, control.time);
        const result = binding.slot.layered!;
        if (control.mode === "override")
          result.blend(binding.pose, control.weight);
        else result.additive(binding.pose, binding.reference, control.weight);
      }
    }
    for (const slot of this.slots) this.write(slot, slot.layered!.values);
  }
  /** Samples a clip into retained pose arrays using binding-local keyframe hints. */
  private sample(binding: AnimationBinding, time: number): void {
    const sampler = binding.channel.sampler;
    // Avoid cursor reads/writes for the common two-key fixture and constant clips.
    if (sampler.input.length > 2)
      binding.keyIndex = sampler.sample(time, binding.output, binding.keyIndex);
    else sampler.sample(time, binding.output);
  }
  /** Writes the composed local node poses and morph weights, marking only changed runtime state dirty. */
  private write(slot: AnimationSlot, v: Float32Array): void {
    if (
      slot.node === this.inPlaceNode &&
      (slot.path === "translation" || slot.path === "rotation")
    )
      v = slot.base.values;
    const e = slot.entity,
      t = this.world.transforms;
    if (
      e < 0 ||
      !this.world.alive[e] ||
      this.world.generation[e] !== slot.generation ||
      !t.has[e]
    )
      return;
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
          // Rotation samplers and blended poses guarantee normalized output.
          t.setNormalizedRotation(e, v[0]!, v[1]!, v[2]!, v[3]!);
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
