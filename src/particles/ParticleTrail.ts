import type { ParticleSystem } from "./ParticleSystem";
import {
  particleRange,
  particleSettings,
  type ParticleColor,
  type ParticleBlend,
  type ParticleSettings,
} from "./ParticleOptions";
import type { ParticleTrails } from "./ParticleTrails";

export interface ParticleTrailOptions {
  maxPoints?: number;
  minDistance?: number;
  lifetime?: number;
  width?: number;
  color?: ParticleColor;
  endColor?: ParticleColor;
  blend?: ParticleBlend;
  curve?: number;
  softDistance?: number;
}
/** Scene-owned ring history for a connected camera-facing ribbon; append world-space points. */
export class ParticleTrail {
  readonly points: Float32Array;
  readonly settings: ParticleSettings;
  readonly minDistance: number;
  readonly maxPoints: number;
  count = 0;
  head = 0;
  disposed = false;
  /** Validate fixed history limits and copy shading settings before reserving a controller. */
  constructor(
    private readonly system: ParticleSystem,
    private readonly owner: ParticleTrails,
    options: ParticleTrailOptions,
  ) {
    this.maxPoints = options.maxPoints ?? owner.pointsPerTrail;
    if (
      !Number.isInteger(this.maxPoints) ||
      this.maxPoints < 2 ||
      this.maxPoints > owner.pointsPerTrail
    )
      throw new Error("Invalid particle trail point capacity");
    this.minDistance = particleRange(
      options.minDistance ?? 0.001,
      0.000001,
      10000,
    );
    const lifetime = options.lifetime ?? 1;
    this.settings = particleSettings({
      lifetime: [lifetime, lifetime],
      startSize: options.width ?? 0.1,
      endSize: options.width ?? 0.1,
      startColor: options.color,
      endColor: options.endColor ?? options.color,
      blend: options.blend,
      curve: options.curve,
      softDistance: options.softDistance,
    });
    this.system.validateSettings(this.settings);
    this.points = new Float32Array(this.maxPoints * 4);
  }
  /** Append a finite point without allocations; close duplicates and disabled systems accept nothing.
   * A full ring evicts its oldest point. Stop appending to let the tail expire naturally. */
  addPoint(x: number, y: number, z: number): boolean {
    if (this.disposed) throw new Error("Particle trail disposed");
    particleRange(x, -Infinity, Infinity);
    particleRange(y, -Infinity, Infinity);
    particleRange(z, -Infinity, Infinity);
    if (!this.system.enabled) return false;
    if (this.count) {
      const o = this.offset(this.count - 1);
      if (
        Math.hypot(
          x - this.points[o]!,
          y - this.points[o + 1]!,
          z - this.points[o + 2]!,
        ) < this.minDistance
      )
        return false;
    }
    if (this.count === this.maxPoints) {
      this.head = (this.head + 1) % this.maxPoints;
      this.count--;
    }
    const o = this.offset(this.count++);
    this.points[o] = x;
    this.points[o + 1] = y;
    this.points[o + 2] = z;
    this.points[o + 3] = this.system.time;
    this.owner.changed = true;
    return true;
  }
  /** Resolve chronological point position in the retained ring without creating typed-array views. */
  offset(index: number): number {
    return ((this.head + index) % this.maxPoints) * 4;
  }
  /** Retire oldest samples against the shared frozen/resumable particle clock. */
  expire(time: number): void {
    while (
      this.count &&
      time - this.points[this.offset(0) + 3]! >= this.settings.lifetime[0]!
    ) {
      this.head = (this.head + 1) % this.maxPoints;
      this.count--;
      this.owner.changed = true;
    }
  }
  /** Clear this controller's history only; other effects in the shared system remain intact. */
  clear(): void {
    this.count = 0;
    this.head = 0;
    this.owner.changed = true;
  }
  /** Remove this ribbon immediately and release its controller slot; safe to call repeatedly. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.owner.remove(this);
  }
}
