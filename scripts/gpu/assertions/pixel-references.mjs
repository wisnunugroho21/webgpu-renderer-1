/** Match the production clear reference in the presentation attachment channel order. */
export function clearPixel(format) {
  return format.startsWith("bgra") ? [36, 20, 10, 255] : [10, 20, 36, 255];
}
/** Normalize a presentation pixel to RGB for scalar/material reference comparisons. */
export function readRGB(format, pixel) {
  return format.startsWith("bgra")
    ? [pixel[2], pixel[1], pixel[0]]
    : pixel.slice(0, 3);
}
/** Decode one sRGB byte before computing linear blend/falloff references. */
export function linear(byte) {
  return byte / 255 <= 0.04045
    ? byte / 255 / 12.92
    : ((byte / 255 + 0.055) / 1.055) ** 2.4;
}
/** Encode a linear reference value with the same sRGB display transfer function. */
export function srgb(value) {
  return Math.round(
    255 *
      (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055),
  );
}
