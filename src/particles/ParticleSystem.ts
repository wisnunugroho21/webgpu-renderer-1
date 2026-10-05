import { ParticleTrails, type ParticleTrailLimits } from "./ParticleTrails";
import type { ParticleTrail, ParticleTrailOptions } from "./ParticleTrail";
import { ParticleCurves, type ParticleCurveKey } from "./ParticleCurves";
import {
  copyParticleAtlas,
  type ParticleAtlasDefinition,
} from "./ParticleAtlas";
import * as particleLayout from "./ParticleLayout";
import { ParticleEmitter } from "./ParticleEmitter";
import {
  particleSettings,
  type ParticleEmitterOptions,
  type ParticleSettings,
  type ParticleVector,
} from "./ParticleOptions";
import { particleEffectOptions, type ParticleEffect } from "./ParticleEffects";
// Capture immutable ABI constants once, keeping imported-value access outside tight loops.
const {
  PARTICLE_WORDS,
  PARTICLE_ORIGIN,
  PARTICLE_BIRTH,
  PARTICLE_VELOCITY,
  PARTICLE_LIFETIME,
  PARTICLE_GRAVITY,
  PARTICLE_DRAG,
  PARTICLE_START_COLOR,
  PARTICLE_END_COLOR,
  PARTICLE_START_SIZE,
  PARTICLE_END_SIZE,
  PARTICLE_ROTATION,
  PARTICLE_SPIN,
  PARTICLE_SHAPE,
  PARTICLE_BLEND,
  PARTICLE_FADE_IN,
  PARTICLE_FADE_OUT,
  PARTICLE_SPRITE,
  PARTICLE_EFFECTS,
} = particleLayout;

/** Fixed-capacity CPU provenance for GPU analytic billboards. No ECS traversal, per-particle objects or readback. */
export class ParticleSystem {
  readonly records: Float32Array;
  readonly curves = new ParticleCurves();
  readonly trails: ParticleTrails;
  private atlasDefinition: ParticleAtlasDefinition | null = null;
  atlasRevision = 0;
  /** Return retained atlas provenance; callers must not mutate its copied pixels. */
  get atlas(): ParticleAtlasDefinition | null {
    return this.atlasDefinition;
  }
  /** Install or clear one shared atlas at a cold boundary; active frame ranges must stay valid. */
  setAtlas(value: ParticleAtlasDefinition | null): void {
    if (this.disposed) throw new Error("Particle system disposed");
    const next = value ? copyParticleAtlas(value) : null;
    const frames = next ? next.columns * next.rows : 1;
    for (const emitter of this.emitters) emitter.validateAtlas(frames);
    for (let i = 0; i < this.count; i++) {
      const o = i * PARTICLE_WORDS;
      if (
        this.records[o + PARTICLE_EFFECTS + 2] &&
        this.records[o + PARTICLE_SPRITE]! +
          this.records[o + PARTICLE_SPRITE + 1]! >
          frames
      )
        throw new Error("Live flipbook exceeds replacement atlas");
    }
    this.atlasDefinition = next;
    this.atlasRevision++;
    if (this.active) for (const prepare of this.owners) prepare();
  }
  /** Create a shared immutable lifetime multiplier profile, deduplicated within 64 slots. */
  createCurve(keys: readonly ParticleCurveKey[]): number {
    if (this.disposed) throw new Error("Particle system disposed");
    return this.curves.create(keys);
  }
  /** Validate external shared references before emitter publication or any random-state mutation. */
  validateSettings(
    settings: ParticleSettings,
    frames = this.atlas ? this.atlas.columns * this.atlas.rows : 1,
  ): void {
    this.curves.require(settings.curve);
    if (settings.textured && settings.sprite[0]! + settings.sprite[1]! > frames)
      throw new Error("Particle flipbook exceeds atlas");
  }
  private liveCount = 0;
  private clock = 0;
  /** Return the dense live record count; particles have no externally recycled numeric IDs. */
  get count(): number {
    return this.liveCount;
  }
  /** Return simulation seconds; disabled systems freeze this clock. */
  get time(): number {
    return this.clock;
  }
  dropped = 0;
  revision = 0;
  dirtyStart = Infinity;
  dirtyEnd = 0;
  private active = false;
  private disposed = false;
  private readonly emitters: ParticleEmitter[] = [];
  private readonly owners = new Set<() => void>();
  /** Allocate one bounded spawn table; GPU storage remains absent until explicitly enabled. */
  constructor(
    readonly capacity = 4096,
    readonly emitterCapacity = 64,
    trailLimits: ParticleTrailLimits = {},
  ) {
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 65536 ||
      !Number.isInteger(emitterCapacity) ||
      emitterCapacity < 1 ||
      emitterCapacity > 1024
    )
      throw new Error("Invalid particle capacity");
    this.records = new Float32Array(capacity * PARTICLE_WORDS);
    this.trails = new ParticleTrails(trailLimits);
  }
  /** Report whether simulation and rendering are active; disabled systems freeze existing particles. */
  get enabled(): boolean {
    return this.active;
  }
  /** Prepare attached GPU owners once at the explicit feature boundary, then enable simulation/rendering. */
  set enabled(value: boolean) {
    if (this.disposed) throw new Error("Particle system disposed");
    if (value && !this.active) for (const prepare of this.owners) prepare();
    this.active = value;
  }
  /** Attach an enable-time GPU setup callback and prepare immediately if already active.
   * The unsubscribe removes only this callback. Dirty-range acknowledgement assumes one active GPU renderer. */
  attach(prepare: () => void): () => void {
    if (this.active) prepare();
    this.owners.add(prepare);
    return () => {
      /* Release only this GPU owner, leaving application particle state intact. */ this.owners.delete(
        prepare,
      );
    };
  }
  /** Install a validated, reusable continuous/burst emitter, bounded independently from particle capacity. */
  createEmitter(options: ParticleEmitterOptions = {}): ParticleEmitter {
    if (this.disposed) throw new Error("Particle system disposed");
    if (this.emitters.length >= this.emitterCapacity)
      throw new Error("Particle emitter capacity exceeded");
    const emitter = new ParticleEmitter(this, options);
    this.emitters.push(emitter);
    return emitter;
  }
  /** Create a fixed-history ribbon controller and prepare GPU resources at this explicit setup boundary. */
  createTrail(options: ParticleTrailOptions = {}): ParticleTrail {
    if (this.disposed) throw new Error("Particle system disposed");
    const trail = this.trails.create(this, options);
    if (this.active) for (const prepare of this.owners) prepare();
    return trail;
  }
  /** Retire an emitter controller without killing particles it already spawned. */
  removeEmitter(emitter: ParticleEmitter): void {
    const index = this.emitters.indexOf(emitter);
    if (index >= 0) this.emitters.splice(index, 1);
  }
  /** Validate and copy a one-shot configuration, then return the number accepted by the bounded pool.
   * This cold event allocation consumes no retained emitter slot; reuse an emitter for repeated emission. */
  burst(options: ParticleEmitterOptions, count: number): number {
    return this.emit(particleSettings(options), count);
  }
  /** Spawn a built-in visual effect at a gameplay event; returns accepted particle count. */
  playEffect(
    effect: ParticleEffect,
    position: ParticleVector,
    scale = 1,
  ): number {
    const preset = particleEffectOptions(effect, position, scale);
    return this.burst(preset.options, preset.count);
  }
  /** Advance controller-owned xorshift32 state and return a uniform value in [0, 1).
   * Zero seeds use a fixed nonzero fallback; keep call order stable for reproducible spawn records. */
  private random(settings: ParticleSettings): number {
    let value = settings.seed || 0x9e3779b9;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    settings.seed = value >>> 0;
    return settings.seed / 4294967296;
  }
  /** Append accepted spawns in dense order and account for overflow without increasing capacity.
   * Random state advances for accepted particles only; existing rows are never changed by a new birth. */
  emit(settings: ParticleSettings, count: number): number {
    if (this.disposed) throw new Error("Particle system disposed");
    if (!Number.isInteger(count) || count < 0 || count > 1000000)
      throw new Error("Invalid particle burst count");
    this.validateSettings(settings);
    if (!this.active) return 0;
    const accepted = Math.min(count, this.capacity - this.count);
    this.dropped += count - accepted;
    const start = this.count;
    for (let i = 0; i < accepted; i++) {
      const o = this.liveCount++ * PARTICLE_WORDS;
      for (let axis = 0; axis < 3; axis++) {
        this.records[o + PARTICLE_ORIGIN + axis] =
          settings.position[axis]! +
          (this.random(settings) * 2 - 1) * settings.positionSpread[axis]!;
        this.records[o + PARTICLE_VELOCITY + axis] =
          settings.velocity[axis]! +
          (this.random(settings) * 2 - 1) * settings.velocitySpread[axis]!;
        this.records[o + PARTICLE_GRAVITY + axis] = settings.gravity[axis]!;
      }
      if (settings.emissionShape) {
        const cos =
          settings.emissionShape === 1
            ? 1 - this.random(settings) * (1 - settings.coneCos)
            : 2 * this.random(settings) - 1;
        const sin = Math.sqrt(Math.max(0, 1 - cos * cos)),
          angle = this.random(settings) * Math.PI * 2;
        const u = Math.cos(angle) * sin,
          v = Math.sin(angle) * sin;
        const speed =
          settings.speed[0]! +
          this.random(settings) * (settings.speed[1]! - settings.speed[0]!);
        const radius =
          settings.radius *
          (settings.emissionShape === 1
            ? Math.sqrt(this.random(settings))
            : Math.cbrt(this.random(settings)));
        const diskAngle = this.random(settings) * Math.PI * 2;
        const diskX = Math.cos(diskAngle),
          diskY = Math.sin(diskAngle);
        for (let axis = 0; axis < 3; axis++) {
          const direction =
            settings.direction[axis]! * cos +
            settings.tangent[axis]! * u +
            settings.bitangent[axis]! * v;
          this.records[o + PARTICLE_VELOCITY + axis]! += direction * speed;
          this.records[o + PARTICLE_ORIGIN + axis]! +=
            radius *
            (settings.emissionShape === 1
              ? settings.tangent[axis]! * diskX +
                settings.bitangent[axis]! * diskY
              : direction);
        }
      }
      this.records.set(settings.sprite, o + PARTICLE_SPRITE);
      this.records[o + PARTICLE_EFFECTS] = settings.curve;
      this.records[o + PARTICLE_EFFECTS + 1] = settings.softDistance;
      this.records[o + PARTICLE_EFFECTS + 2] = settings.textured;
      this.records[o + PARTICLE_EFFECTS + 3] = 0;
      this.records[o + PARTICLE_BIRTH] = this.time;
      this.records[o + PARTICLE_LIFETIME] =
        settings.lifetime[0]! +
        this.random(settings) * (settings.lifetime[1]! - settings.lifetime[0]!);
      this.records[o + PARTICLE_DRAG] = settings.drag;
      this.records.set(settings.startColor, o + PARTICLE_START_COLOR);
      this.records.set(settings.endColor, o + PARTICLE_END_COLOR);
      this.records[o + PARTICLE_START_SIZE] = settings.startSize;
      this.records[o + PARTICLE_END_SIZE] = settings.endSize;
      this.records[o + PARTICLE_ROTATION] = settings.rotation;
      this.records[o + PARTICLE_SPIN] = settings.angularVelocity;
      this.records[o + PARTICLE_SHAPE] = settings.shape;
      this.records[o + PARTICLE_BLEND] = settings.blend;
      this.records[o + PARTICLE_FADE_IN] = settings.fadeIn;
      this.records[o + PARTICLE_FADE_OUT] = settings.fadeOut;
    }
    if (accepted) this.markDirty(start, this.count);
    return accepted;
  }
  /** Mark changed rows; motion alone changes only the global time uniform, not spawn records. */
  private markDirty(start: number, end: number): void {
    this.dirtyStart = Math.min(this.dirtyStart, start);
    this.dirtyEnd = Math.max(this.dirtyEnd, end);
    this.revision++;
  }
  /** Advance the clock, swap-remove expired rows, then emit into newly freed capacity.
   * Recheck a swapped row before incrementing: it may also have expired. Motion remains GPU-analytic. */
  update(delta: number): void {
    if (!Number.isFinite(delta) || delta < 0 || delta > 3600)
      throw new Error("Invalid particle delta");
    if (!this.active || this.disposed) return;
    this.clock += delta;
    for (let i = 0; i < this.count;) {
      const o = i * PARTICLE_WORDS;
      if (
        this.time - this.records[o + PARTICLE_BIRTH]! >=
        this.records[o + PARTICLE_LIFETIME]!
      ) {
        const last = --this.liveCount * PARTICLE_WORDS;
        if (o !== last) {
          this.records.copyWithin(o, last, last + PARTICLE_WORDS);
          this.markDirty(i, i + 1);
        }
        this.revision++;
      } else i++;
    }
    this.trails.update(this.time);
    for (let i = 0; i < this.emitters.length; i++)
      this.emitters[i]!.update(delta);
  }
  /** Clear the whole shared pool while retaining emitters, random state, counters and simulation time.
   * Stop scene-owned emitters first or they will fill the pool again on the next active tick. */
  clear(): void {
    this.liveCount = 0;
    this.trails.clear();
    this.revision++;
    this.dirtyStart = Infinity;
    this.dirtyEnd = 0;
  }
  /** Stop emitters, hide particles and detach GPU setup listeners at application teardown. */
  dispose(): void {
    if (this.disposed) return;
    while (this.emitters.length)
      this.emitters[this.emitters.length - 1]!.dispose();
    this.trails.dispose();
    this.clear();
    this.owners.clear();
    this.active = false;
    this.disposed = true;
  }
}
