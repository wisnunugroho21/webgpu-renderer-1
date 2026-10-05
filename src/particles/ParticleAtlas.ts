export interface ParticleAtlasDefinition {
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** Top-down straight-alpha RGBA8 pixels; installation copies caller memory. */
  pixels: Uint8Array;
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
  };
}
