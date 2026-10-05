/** Binary ABI shared by CPU spawn records and particles.wgsl; offsets are f32 words.
 * Seven vec4 rows hold origin/birth, velocity/lifetime, gravity/drag, start/end
 * colors, size/rotation/spin, then shape/blend/fades. Keep shader fields in sync. */
export const PARTICLE_WORDS = 28;
export const PARTICLE_BYTES = PARTICLE_WORDS * 4;
export const PARTICLE_ORIGIN = 0;
export const PARTICLE_BIRTH = 3;
export const PARTICLE_VELOCITY = 4;
export const PARTICLE_LIFETIME = 7;
export const PARTICLE_GRAVITY = 8;
export const PARTICLE_DRAG = 11;
export const PARTICLE_START_COLOR = 12;
export const PARTICLE_END_COLOR = 16;
export const PARTICLE_START_SIZE = 20;
export const PARTICLE_END_SIZE = 21;
export const PARTICLE_ROTATION = 22;
export const PARTICLE_SPIN = 23;
export const PARTICLE_SHAPE = 24;
export const PARTICLE_BLEND = 25;
export const PARTICLE_FADE_IN = 26;
export const PARTICLE_FADE_OUT = 27;

/** mat4 view-projection, vec4 camera right/up and vec4 clock, padded to uniform alignment. */
export const PARTICLE_FRAME_WORDS = 28;
export const PARTICLE_FRAME_BYTES = PARTICLE_FRAME_WORDS * 4;
