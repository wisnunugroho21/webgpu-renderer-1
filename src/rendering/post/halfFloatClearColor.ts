/** Clamp before half-float conversion; an overflowing clear becomes infinity before tone mapping can sanitize it. */
export function halfFloatClearColor(
  color: GPUColor,
  target: number[],
): number[] {
  if ("r" in color) {
    target[0] = color.r;
    target[1] = color.g;
    target[2] = color.b;
    target[3] = color.a;
  } else {
    let index = 0;
    for (const value of color) {
      if (index === 4)
        throw new TypeError("Clear color requires four channels");
      target[index++] = value;
    }
    if (index !== 4) throw new TypeError("Clear color requires four channels");
  }
  for (let index = 0; index < 4; index++)
    target[index] = Math.max(-65504, Math.min(65504, target[index]!));
  return target;
}
