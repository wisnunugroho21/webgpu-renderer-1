import type { ParticleEmitterOptions, ParticleVector } from "./ParticleOptions";
export type ParticleEffect =
  "sparks" | "smoke" | "explosion" | "confetti" | "shockwave";
const effects: Record<
  ParticleEffect,
  { count: number; options: ParticleEmitterOptions }
> = {
  sparks: {
    count: 48,
    options: {
      velocity: [0, 2, 0],
      velocitySpread: [4, 4, 4],
      gravity: [0, -8, 0],
      lifetime: [0.3, 0.8],
      startColor: [4, 1.5, 0.1, 1],
      endColor: [1, 0.1, 0, 0],
      startSize: 0.08,
      blend: "additive",
      shape: "glow",
    },
  },
  smoke: {
    count: 20,
    options: {
      velocity: [0, 0.7, 0],
      velocitySpread: [0.3, 0.2, 0.3],
      drag: 0.5,
      lifetime: [2, 3],
      startColor: [0.15, 0.15, 0.18, 0.5],
      endColor: [0.3, 0.3, 0.35, 0],
      startSize: 0.25,
      endSize: 1.5,
      fadeIn: 0.1,
      shape: "glow",
    },
  },
  explosion: {
    count: 96,
    options: {
      velocity: [0, 0, 0],
      velocitySpread: [5, 5, 5],
      drag: 3,
      lifetime: [0.4, 1],
      startColor: [6, 2, 0.1, 1],
      endColor: [0.6, 0.05, 0, 0],
      startSize: 0.35,
      endSize: 0.8,
      shape: "glow",
      blend: "additive",
    },
  },
  confetti: {
    count: 64,
    options: {
      velocity: [0, 3, 0],
      velocitySpread: [2, 2, 2],
      gravity: [0, -3, 0],
      drag: 0.5,
      lifetime: [2, 4],
      startColor: [0.1, 0.8, 1, 1],
      endColor: [1, 0.15, 0.8, 0],
      startSize: 0.1,
      endSize: 0.1,
      angularVelocity: 5,
      shape: "square",
    },
  },
  shockwave: {
    count: 1,
    options: {
      velocity: [0, 0, 0],
      velocitySpread: [0, 0, 0],
      lifetime: [0.6, 0.6],
      startColor: [2, 0.7, 0.1, 1],
      endColor: [0.3, 0.1, 0, 0],
      startSize: 0.1,
      endSize: 5,
      shape: "ring",
      blend: "additive",
    },
  },
};
/** Copy a three-component vector with consistent spatial scaling at an effect event. */
function scaled(vector: ParticleVector, scale: number): ParticleVector {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}
/** Build a one-shot configuration at an event boundary; scale controls spatial extent rather than duration. */
export function particleEffectOptions(
  effect: ParticleEffect,
  position: ParticleVector,
  scale: number,
): { count: number; options: ParticleEmitterOptions } {
  const preset = effects[effect];
  if (!preset || !Number.isFinite(scale) || scale <= 0 || scale > 100)
    throw new Error("Invalid particle effect");
  const options = preset.options;
  return {
    count: preset.count,
    options: {
      ...options,
      position,
      startSize: options.startSize! * scale,
      endSize: (options.endSize ?? 0) * scale,
      velocity: scaled(options.velocity!, scale),
      velocitySpread: scaled(options.velocitySpread!, scale),
      gravity: scaled(options.gravity ?? [0, 0, 0], scale),
    },
  };
}
