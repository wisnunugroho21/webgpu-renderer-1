export interface ParticleAtlasDefinition {
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** Top-down straight-alpha RGBA8 pixels; installation copies caller memory. */
  pixels: Uint8Array;
  /** Opt-in tile-safe mipmaps; odd tile dimensions stop the chain before tile boundaries mix. */
  mipmaps?: boolean;
  colorSpace?: "srgb" | "linear";
}
/** Validate a bounded evenly tiled atlas before any live definition or GPU owner changes. */
export function copyParticleAtlas(
  value: ParticleAtlasDefinition,
): ParticleAtlasDefinition {
  const { width, height, columns, rows, pixels } = value;
  if (
    ![width, height, columns, rows].every(
      (v) =>
        /** Atlas dimensions must be positive integers. */ Number.isSafeInteger(
          v,
        ) && v > 0,
    ) ||
    width > 4096 ||
    height > 4096 ||
    columns * rows > 4096 ||
    width % columns ||
    height % rows ||
    !(pixels instanceof Uint8Array) ||
    pixels.byteLength !== width * height * 4 ||
    pixels.byteLength > 64 * 1024 * 1024 ||
    (value.mipmaps !== undefined && typeof value.mipmaps !== "boolean") ||
    (value.colorSpace !== undefined &&
      value.colorSpace !== "srgb" &&
      value.colorSpace !== "linear")
  )
    throw new Error("Invalid particle atlas");
  return {
    width,
    height,
    columns,
    rows,
    pixels: pixels.slice(),
    colorSpace: value.colorSpace ?? "srgb",
    mipmaps: value.mipmaps ?? false,
  };
}

/** Count only exact two-by-two reductions that keep every tile on integer texel boundaries. */
export function particleAtlasMipLevels(
  atlas: ParticleAtlasDefinition | null,
): number {
  if (!atlas?.mipmaps) return 1;
  let width = atlas.width / atlas.columns,
    height = atlas.height / atlas.rows,
    levels = 1;
  while (width > 1 && height > 1 && width % 2 === 0 && height % 2 === 0) {
    width /= 2;
    height /= 2;
    levels++;
  }
  return levels;
}
