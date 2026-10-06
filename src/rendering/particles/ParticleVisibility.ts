import { Frustum } from "../../math/Frustum";
import type { ParticleSystem } from "../../particles/ParticleSystem";
import { PARTICLE_WORDS } from "../../particles/ParticleLayout";
/** Conservative analytic bounds; fixed frustum scratch avoids CPU vertices, GPU queries and recovery state. */
export class ParticleVisibility {
  private readonly frustum = new Frustum();
  /** Refresh normalized clipping planes once per observed camera. */
  prepare(matrix: Float32Array): void {
    this.frustum.setFromMatrix(matrix);
  }
  /** Keep numerical uncertainty and entire spheres that intersect any clipping boundary. */
  sphere(x: number, y: number, z: number, radius: number): boolean {
    const padding = Math.max(
      0.0001,
      (Math.abs(x) + Math.abs(y) + Math.abs(z)) * 0.00001,
    );
    const p = this.frustum.planes;
    for (let plane = 0; plane < 24; plane += 4)
      if (
        p[plane]! * x + p[plane + 1]! * y + p[plane + 2]! * z + p[plane + 3]! <
        -radius - padding
      )
        return false;
    return true;
  }
  /** Bound a rotated billboard using analytic center and the maximum authored lifetime diameter. */
  billboard(system: ParticleSystem, index: number): boolean {
    const r = system.records,
      o = index * PARTICLE_WORDS;
    const age = Math.max(0, Math.fround(system.time) - r[o + 3]!),
      drag = r[o + 11]!;
    const integral = drag > 0.0001 ? (1 - Math.exp(-drag * age)) / drag : age;
    const acceleration =
      drag > 0.0001 ? (age - integral) / drag : 0.5 * age * age;
    const x = r[o]! + r[o + 4]! * integral + r[o + 8]! * acceleration,
      y = r[o + 1]! + r[o + 5]! * integral + r[o + 9]! * acceleration,
      z = r[o + 2]! + r[o + 6]! * integral + r[o + 10]! * acceleration;
    const radius =
      Math.max(r[o + 20]!, r[o + 21]!) *
      system.curves.maxSizes[r[o + 32]!]! *
      Math.SQRT1_2;
    const error =
      (Math.abs(r[o + 4]! * integral) +
        Math.abs(r[o + 5]! * integral) +
        Math.abs(r[o + 6]! * integral) +
        Math.abs(r[o + 8]! * acceleration) +
        Math.abs(r[o + 9]! * acceleration) +
        Math.abs(r[o + 10]! * acceleration)) *
      0.00001;
    return this.sphere(x, y, z, radius + error);
  }
  /** Enclose both ribbon endpoints and the shader's four-times-width miter cap. */
  ribbon(system: ParticleSystem, index: number): boolean {
    const r = system.trails.records,
      o = index * PARTICLE_WORDS;
    const x = (r[o]! + r[o + 4]!) * 0.5,
      y = (r[o + 1]! + r[o + 5]!) * 0.5,
      z = (r[o + 2]! + r[o + 6]!) * 0.5;
    const radius =
      Math.hypot(
        r[o]! - r[o + 4]!,
        r[o + 1]! - r[o + 5]!,
        r[o + 2]! - r[o + 6]!,
      ) *
        0.5 +
      r[o + 20]! * 2 * system.curves.maxSizes[r[o + 32]!]!;
    return this.sphere(x, y, z, radius);
  }
}
