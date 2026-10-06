/** Motion object = model mat4 + the existing 12-word instance metadata, with history validity in word 27.
 * Keep these widths synchronized with createMotionShader's WGSL object addressing. */
export const MOTION_OBJECT_WORDS = 28;
export const MOTION_OBJECT_BYTES = MOTION_OBJECT_WORDS * 4;
/** Current/previous camera matrices plus four words locating previous joint/morph ranges. */
export const MOTION_FRAME_WORDS = 36;
export const MOTION_FRAME_BYTES = MOTION_FRAME_WORDS * 4;
/** Resolve controls, inverse/current and previous camera matrices, and jitter delta/padding. */
export const TEMPORAL_SETTINGS_WORDS = 40;
export const TEMPORAL_SETTINGS_BYTES = TEMPORAL_SETTINGS_WORDS * 4;
