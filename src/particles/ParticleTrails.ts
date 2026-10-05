import type { ParticleSystem } from "./ParticleSystem";
import { ParticleTrail, type ParticleTrailOptions } from "./ParticleTrail";
import * as layout from "./ParticleLayout";
const { PARTICLE_WORDS } = layout;

export interface ParticleTrailLimits {
  capacity?: number;
  pointsPerTrail?: number;
}
/** Bounded controller collection and dense ribbon snapshot, sharing the billboard binary stride. */
export class ParticleTrails {
  readonly capacity: number;
  readonly pointsPerTrail: number;
  readonly segmentCapacity: number;
  readonly records: Float32Array;
  private readonly scratch = new Float32Array(PARTICLE_WORDS);
  private readonly controllers: ParticleTrail[] = [];
  count = 0;
  revision = 0;
  dirtyStart = Infinity;
  dirtyEnd = 0;
  changed = false;
  /** Allocate fixed CPU snapshot storage; GPU resources wait until a trail controller is installed. */
  constructor(limits: ParticleTrailLimits = {}) {
    this.capacity = limits.capacity ?? 32;
    this.pointsPerTrail = limits.pointsPerTrail ?? 128;
    this.segmentCapacity = this.capacity * (this.pointsPerTrail - 1);
    if (
      !Number.isInteger(this.capacity) ||
      this.capacity < 1 ||
      this.capacity > 128 ||
      !Number.isInteger(this.pointsPerTrail) ||
      this.pointsPerTrail < 2 ||
      this.pointsPerTrail > 512 ||
      this.segmentCapacity > 65536
    )
      throw new Error("Invalid particle trail capacity");
    this.records = new Float32Array(this.segmentCapacity * PARTICLE_WORDS);
  }
  /** Expose bounded history backing stores for cold recovery-memory accounting. */
  recoverySources(): unknown[] {
    return [this.records, ...this.controllers];
  }
  /** Whether cold renderer setup must prepare the ribbon buffers and bounded pipeline table. */
  get installed(): boolean {
    return this.controllers.length > 0;
  }
  /** Publish a validated controller without exceeding fixed history/segment budgets. */
  create(system: ParticleSystem, options: ParticleTrailOptions): ParticleTrail {
    if (this.controllers.length === this.capacity)
      throw new Error("Particle trail capacity exceeded");
    const trail = new ParticleTrail(system, this, options);
    this.controllers.push(trail);
    return trail;
  }
  /** Remove only the disposed controller and request dense snapshot compaction. */
  remove(trail: ParticleTrail): void {
    const i = this.controllers.indexOf(trail);
    if (i >= 0) this.controllers.splice(i, 1);
    this.changed = true;
  }
  /** Expire histories once per application particle tick without allocating arrays. */
  update(time: number): void {
    for (const trail of this.controllers) trail.expire(time);
  }
  /** Pack changed histories, preserving previous/next neighbors for GPU miter joins.
   * Compare Float32 rows so only the changed dense interval is uploaded; clock-only frames do no packing. */
  prepare(): void {
    if (!this.changed) return;
    this.changed = false;
    let count = 0;
    const row = this.scratch;
    for (const trail of this.controllers) {
      const p = trail.points,
        s = trail.settings;
      for (let i = 0; i < trail.count - 1; i++) {
        const a = trail.offset(i),
          b = trail.offset(i + 1),
          prev = trail.offset(Math.max(0, i - 1)),
          next = trail.offset(Math.min(trail.count - 1, i + 2));
        // Ribbon ABI reuses nine vec4 rows: start/birth, end/birth, previous,
        // start/end tint, width/lifetime, blend, next neighbor, and curve/soft metadata.
        // ParticleRenderer and trailVS interpret these rows as segments, never as ballistic billboards.
        row.fill(0);
        for (let axis = 0; axis < 3; axis++) {
          row[axis] = p[a + axis]!;
          row[4 + axis] = p[b + axis]!;
          row[8 + axis] = p[prev + axis]!;
          row[28 + axis] = p[next + axis]!;
        }
        row[3] = p[a + 3]!;
        row[7] = p[b + 3]!;
        row.set(s.startColor, 12);
        row.set(s.endColor, 16);
        row[20] = s.startSize;
        row[21] = s.lifetime[0]!;
        row[25] = s.blend;
        row[32] = s.curve;
        row[33] = s.softDistance;
        const offset = count * PARTICLE_WORDS;
        let changed = false;
        for (let k = 0; k < PARTICLE_WORDS; k++)
          if (this.records[offset + k] !== row[k]) {
            this.records[offset + k] = row[k]!;
            changed = true;
          }
        if (changed) {
          this.dirtyStart = Math.min(this.dirtyStart, count);
          this.dirtyEnd = Math.max(this.dirtyEnd, count + 1);
        }
        count++;
      }
    }
    this.count = count;
    this.revision++;
  }
  /** Clear all ribbon histories without retiring scene-owned controllers. */
  clear(): void {
    for (const trail of this.controllers) trail.clear();
    this.prepare();
  }
  /** Retire all controllers while leaving GPU destruction to renderer Resources. */
  dispose(): void {
    while (this.controllers.length)
      this.controllers[this.controllers.length - 1]!.dispose();
    this.prepare();
  }
}
