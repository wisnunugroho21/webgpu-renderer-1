import type { ParticleColor } from "./ParticleOptions";

export interface ParticleCurveKey {
  /** Normalized age; endpoints must include zero and one. */
  time: number;
  /** Multiplies interpolated billboard diameter or ribbon width. */
  size?: number;
  /** Multiplies interpolated linear RGBA, including opacity. */
  color?: ParticleColor;
}
export const PARTICLE_CURVE_WORDS = 36;
export const PARTICLE_CURVE_CAPACITY = 64;

/** Fixed four-key profiles shared by all particles; immutable IDs survive recovery. */
export class ParticleCurves {
  readonly records = new Float32Array(
    PARTICLE_CURVE_WORDS * PARTICLE_CURVE_CAPACITY,
  );
  readonly maxSizes = new Float32Array(PARTICLE_CURVE_CAPACITY);
  count = 0;
  /** Install profile zero as identity; CPU storage does not allocate GPU resources. */
  constructor() {
    this.create([{ time: 0 }, { time: 1 }]);
  }
  /** Validate/copy two to four keys and deduplicate before reserving a lifetime-stable ID. */
  create(keys: readonly ParticleCurveKey[]): number {
    if (
      keys.length < 2 ||
      keys.length > 4 ||
      keys[0]?.time !== 0 ||
      keys.at(-1)?.time !== 1
    )
      throw new Error("Particle curve needs 2–4 keys spanning 0–1");
    const row = new Float32Array(PARTICLE_CURVE_WORDS);
    row[0] = keys.length;
    let previous = -1;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (
        !key ||
        !Number.isFinite(key.time) ||
        key.time <= previous ||
        key.time > 1 ||
        Math.fround(key.time) <= Math.fround(previous)
      )
        throw new Error("Invalid particle curve time");
      previous = key.time;
      const size = key.size ?? 1,
        color = key.color ?? [1, 1, 1, 1];
      if (
        !Number.isFinite(size) ||
        size < 0 ||
        size > 100 ||
        color.length !== 4
      )
        throw new Error("Invalid particle curve value");
      const o = 4 + i * 8;
      row[o] = key.time;
      row[o + 1] = size;
      for (let c = 0; c < 4; c++) {
        const value = color[c];
        if (
          value === undefined ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > (c === 3 ? 1 : 100)
        )
          throw new Error("Invalid particle curve color");
        row[o + 4 + c] = value;
      }
    }
    for (let id = 0; id < this.count; id++) {
      let equal = true;
      for (let i = 0; i < row.length && equal; i++)
        equal = this.records[id * PARTICLE_CURVE_WORDS + i] === row[i];
      if (equal) return id;
    }
    if (this.count === PARTICLE_CURVE_CAPACITY)
      throw new Error("Particle curve capacity exceeded");
    const id = this.count++;
    this.records.set(row, id * PARTICLE_CURVE_WORDS);
    for (let key = 0; key < keys.length; key++)
      this.maxSizes[id] = Math.max(this.maxSizes[id]!, row[5 + key * 8]!);
    return id;
  }
  /** Reject unknown profile IDs before publishing emitter or burst settings. */
  require(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.count)
      throw new Error("Unknown particle curve");
  }
}
