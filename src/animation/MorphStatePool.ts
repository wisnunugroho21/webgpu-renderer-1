import { MorphState } from "./Animator";
/** Shared weight arena; each node instance owns a range reused by its primitives. */
export class MorphStatePool {
  readonly data: Float32Array;
  readonly states: MorphState[] = [];
  count = 0;
  constructor(readonly capacity = 65536) {
    this.data = new Float32Array(capacity);
  }
  create(targetCount: number, initial: ArrayLike<number> = []): number {
    if (
      !Number.isInteger(targetCount) ||
      targetCount < 1 ||
      this.count + targetCount > this.capacity
    )
      throw new Error("Morph weight capacity exceeded");
    if (initial.length && initial.length !== targetCount)
      throw new Error("Invalid default morph weights");
    for (let i = 0; i < initial.length; i++)
      if (!Number.isFinite(initial[i])) throw new Error("Invalid morph weight");
    const offset = this.count,
      weights = this.data.subarray(offset, offset + targetCount);
    this.count += targetCount;
    for (let i = 0; i < initial.length; i++) weights[i] = initial[i]!;
    return (
      this.states.push({
        weights,
        weightOffset: offset,
        targetCount,
        dirty: true,
      }) - 1
    );
  }
}
