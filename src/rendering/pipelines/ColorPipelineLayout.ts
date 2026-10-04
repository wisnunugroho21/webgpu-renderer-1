/** Queue IDs: three alpha modes × two sidedness modes × three primitive topologies.
 * Color tables repeat those IDs for depth-read-only and indirect-vertex variants. */
export const MATERIAL_PIPELINE_VARIANTS = 18;
export const BLEND_PIPELINE_OFFSET = 12;
export const DEPTH_READ_ONLY_OFFSET = MATERIAL_PIPELINE_VARIANTS;
export const INDIRECT_VERTEX_OFFSET = MATERIAL_PIPELINE_VARIANTS * 2;
export const COLOR_PIPELINE_COUNT = MATERIAL_PIPELINE_VARIANTS * 4;
