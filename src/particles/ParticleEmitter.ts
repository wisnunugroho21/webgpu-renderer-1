import type { ParticleSystem } from "./ParticleSystem";
import {
  particleSettings,
  particleRange,
  type ParticleEmitterOptions,
  type ParticleSettings,
} from "./ParticleOptions";
/** A reusable spawn controller; it owns no entity, texture or GPU resource. */
export class ParticleEmitter {
  emitting = true;
  private dead = false;
  /** Report controller retirement without allowing callers to bypass slot cleanup. */
  get disposed(): boolean {
    return this.dead;
  }
  private remainder = 0;
  private settings: ParticleSettings;
  /** Copy validated settings and retain seeded random state for repeatable effects. */
  constructor(
    private readonly system: ParticleSystem,
    options: ParticleEmitterOptions,
  ) {
    this.settings = particleSettings(options);
  }
  /** Return the continuous emission rate in particles per simulation second. */
  get rate(): number {
    return this.settings.rate;
  }
  /** Adjust emission density without resetting seeded state, fractional remainder or existing particles. */
  set rate(value: number) {
    if (this.disposed) throw new Error("Particle emitter disposed");
    this.settings.rate = particleRange(value, 0, 1000000);
  }
  /** Replace the entire configuration, restoring defaults for omitted fields.
   * Validation completes before mutation; seed and fractional emission restart, while live particles retain their records. */
  configure(options: ParticleEmitterOptions): void {
    if (this.disposed) throw new Error("Particle emitter disposed");
    const next = particleSettings(options);
    this.settings = next;
    this.remainder = 0;
  }
  /** Move the spawn origin without allocating a new configuration or modifying live particles. */
  setPosition(x: number, y: number, z: number): void {
    if (this.disposed) throw new Error("Particle emitter disposed");
    particleRange(x, -Infinity, Infinity);
    particleRange(y, -Infinity, Infinity);
    particleRange(z, -Infinity, Infinity);
    this.settings.position[0] = x;
    this.settings.position[1] = y;
    this.settings.position[2] = z;
  }
  /** Emit an immediate burst independently of continuous emitting state.
   * Returns accepted particles; disabled systems accept zero and full pools drop newest requests. */
  burst(count: number): number {
    if (this.disposed) throw new Error("Particle emitter disposed");
    return this.system.emit(this.settings, count);
  }
  /** Internal system-owned tick after expiration frees capacity; callers normally let Application advance it.
   * Retain only a fractional particle, drop excess requests, and never accumulate a capacity backlog. */
  update(delta: number): void {
    if (!this.emitting || this.disposed || !this.system.enabled) return;
    const wanted = this.remainder + this.settings.rate * delta;
    const count = Math.floor(wanted);
    this.remainder = wanted - count;
    if (count) {
      const requested = Math.min(count, 1000000);
      // Account for throttled requests too; a long hitch must not underreport dropped particles.
      this.system.dropped += count - requested;
      this.system.emit(this.settings, requested);
    }
  }
  /** Stop future emission and release the emitter slot; live particles finish their own lifetimes. */
  dispose(): void {
    if (this.disposed) return;
    this.dead = true;
    this.system.removeEmitter(this);
  }
}
