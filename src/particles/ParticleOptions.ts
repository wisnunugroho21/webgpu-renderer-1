export type ParticleVector = readonly [number, number, number];
export type ParticleColor = readonly [number, number, number, number];
export type ParticleShape = "disc" | "glow" | "ring" | "square";
export type ParticleBlend = "alpha" | "additive";
export interface ParticleFlipbook {
  firstFrame?: number;
  frameCount?: number;
  /** Omitted rate maps the animation once over lifetime; zero holds the first frame. */
  fps?: number;
  loop?: boolean;
}
export interface ParticleEmission {
  shape: "cone" | "sphere";
  direction?: ParticleVector;
  /** Cone half-angle in radians, 0–pi/2. */
  angle?: number;
  /** Uniform volume sphere or cone-origin disk radius in world units. */
  radius?: number;
  speed?: readonly [number, number];
}
/** World-space emitter settings copied at installation; existing particles retain their spawn settings. */
export interface ParticleEmitterOptions {
  sprite?: ParticleFlipbook;
  curve?: number;
  softDistance?: number;
  emission?: ParticleEmission;
  position?: ParticleVector;
  positionSpread?: ParticleVector;
  velocity?: ParticleVector;
  velocitySpread?: ParticleVector;
  gravity?: ParticleVector;
  drag?: number;
  lifetime?: readonly [number, number];
  startColor?: ParticleColor;
  endColor?: ParticleColor;
  startSize?: number;
  endSize?: number;
  rotation?: number;
  angularVelocity?: number;
  shape?: ParticleShape;
  blend?: ParticleBlend;
  fadeIn?: number;
  fadeOut?: number;
  rate?: number;
  seed?: number;
}
// Compatibility exports; record consumers import the ABI directly from ParticleLayout.
export { PARTICLE_WORDS, PARTICLE_BYTES } from "./ParticleLayout";
export interface ParticleSettings {
  sprite: number[];
  textured: number;
  curve: number;
  softDistance: number;
  emissionShape: number;
  direction: number[];
  tangent: number[];
  bitangent: number[];
  coneCos: number;
  radius: number;
  speed: number[];
  position: number[];
  positionSpread: number[];
  velocity: number[];
  velocitySpread: number[];
  gravity: number[];
  startColor: number[];
  endColor: number[];
  lifetime: number[];
  drag: number;
  startSize: number;
  endSize: number;
  rotation: number;
  angularVelocity: number;
  shape: number;
  blend: number;
  fadeIn: number;
  fadeOut: number;
  rate: number;
  seed: number;
}
/** Reject nonfinite/overflowing GPU values before copying a vector or mutating emitter state. */
function vector(
  values: readonly number[],
  length: number,
  min = -Infinity,
): number[] {
  if (values.length !== length) throw new Error("Invalid particle vector");
  for (let i = 0; i < length; i++) {
    const value = values[i];
    // Indexed validation also rejects sparse arrays; array predicates would skip missing components.
    if (
      value === undefined ||
      !Number.isFinite(value) ||
      !Number.isFinite(Math.fround(value)) ||
      value < min
    )
      throw new Error("Invalid particle vector");
  }
  return Array.from(values);
}
/** Validate a scalar control once at setup, keeping spawn and frame loops branch-light. */
export function particleRange(value: number, min: number, max: number): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(Math.fround(value)) ||
    value < min ||
    value > max
  )
    throw new Error("Invalid particle setting");
  return value;
}
/** Normalize defaults and copy caller arrays so subsequent caller mutation cannot alter an emitter. */
export function particleSettings(
  options: ParticleEmitterOptions,
): ParticleSettings {
  const shape = ["disc", "glow", "ring", "square"].indexOf(
    options.shape ?? "disc",
  );
  const blend = ["alpha", "additive"].indexOf(options.blend ?? "alpha");
  if (shape < 0 || blend < 0) throw new Error("Invalid particle shape/blend");
  const lifetime = vector(options.lifetime ?? [1, 2], 2, 0.001);
  if (lifetime[1]! < lifetime[0]! || lifetime[1]! > 3600)
    throw new Error("Invalid particle lifetime");
  const startColor = vector(options.startColor ?? [1, 1, 1, 1], 4, 0);
  const endColor = vector(options.endColor ?? [1, 1, 1, 0], 4, 0);
  if (startColor[3]! > 1 || endColor[3]! > 1)
    throw new Error("Invalid particle alpha");
  const seed = options.seed ?? 1;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("Invalid particle seed");
  const sprite = options.sprite;
  const firstFrame = sprite?.firstFrame ?? 0,
    frameCount = sprite?.frameCount ?? 1;
  if (
    !Number.isInteger(firstFrame) ||
    firstFrame < 0 ||
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    firstFrame + frameCount > 4096
  )
    throw new Error("Invalid particle flipbook range");
  const curve = options.curve ?? 0;
  if (!Number.isInteger(curve) || curve < 0 || curve >= 64)
    throw new Error("Invalid particle curve");
  const emission = options.emission;
  if (emission && emission.shape !== "cone" && emission.shape !== "sphere")
    throw new Error("Invalid particle emission shape");
  const direction = vector(emission?.direction ?? [0, 1, 0], 3);
  const length = Math.hypot(...direction);
  if (!length) throw new Error("Particle direction must be nonzero");
  for (let i = 0; i < 3; i++) direction[i] = direction[i]! / length;
  const tangent =
    Math.abs(direction[1]!) < 0.99
      ? [direction[2]!, 0, -direction[0]!]
      : [1, 0, 0];
  const tangentLength = Math.hypot(...tangent);
  for (let i = 0; i < 3; i++) tangent[i] = tangent[i]! / tangentLength;
  const bitangent = [
    direction[1]! * tangent[2]! - direction[2]! * tangent[1]!,
    direction[2]! * tangent[0]! - direction[0]! * tangent[2]!,
    direction[0]! * tangent[1]! - direction[1]! * tangent[0]!,
  ];
  const speed = vector(emission?.speed ?? [1, 1], 2, 0);
  if (speed[1]! < speed[0]! || speed[1]! > 10000)
    throw new Error("Invalid particle speed");
  return {
    sprite: [
      firstFrame,
      frameCount,
      sprite?.fps === undefined ? -1 : particleRange(sprite.fps, 0, 1000),
      sprite?.loop ? 1 : 0,
    ],
    textured: sprite ? 1 : 0,
    curve,
    softDistance: particleRange(options.softDistance ?? 0, 0, 10000),
    emissionShape: emission ? (emission.shape === "cone" ? 1 : 2) : 0,
    direction,
    tangent,
    bitangent,
    coneCos: Math.cos(
      particleRange(emission?.angle ?? Math.PI / 6, 0, Math.PI / 2),
    ),
    radius: particleRange(emission?.radius ?? 0, 0, 10000),
    speed,
    position: vector(options.position ?? [0, 0, 0], 3),
    positionSpread: vector(options.positionSpread ?? [0, 0, 0], 3, 0),
    velocity: vector(options.velocity ?? [0, 1, 0], 3),
    velocitySpread: vector(options.velocitySpread ?? [1, 1, 1], 3, 0),
    gravity: vector(options.gravity ?? [0, 0, 0], 3),
    startColor,
    endColor,
    lifetime,
    drag: particleRange(options.drag ?? 0, 0, 100),
    startSize: particleRange(options.startSize ?? 0.2, 0.00001, 10000),
    endSize: particleRange(options.endSize ?? 0, 0, 10000),
    rotation: particleRange(options.rotation ?? 0, -10000, 10000),
    angularVelocity: particleRange(options.angularVelocity ?? 0, -1000, 1000),
    fadeIn: particleRange(options.fadeIn ?? 0, 0, 1),
    fadeOut: particleRange(options.fadeOut ?? 0, 0, 1),
    rate: particleRange(options.rate ?? 0, 0, 1000000),
    shape,
    blend,
    seed,
  };
}
