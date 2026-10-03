/** Practical split: mix uniform and logarithmic view-space distances. */
export function cascadeSplit(
  near: number,
  far: number,
  index: number,
  count: number,
  lambda = 0.6,
): number {
  if (!(
    near > 0 &&
    far > near &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 4 &&
    Number.isInteger(index) &&
    index >= 1 &&
    index <= count &&
    lambda >= 0 &&
    lambda <= 1
  ))
    throw new Error("Invalid cascade split");
  const t = index / count;
  return (
    lambda * near * (far / near) ** t + (1 - lambda) * (near + (far - near) * t)
  );
}
