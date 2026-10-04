import { RangeAllocator } from "../assets/RangeAllocator";
import { MorphState } from "./Animator";
/** Shared weight arena; each node instance owns a range reused by its primitives. */
export class MorphStatePool {
  readonly data: Float32Array;
  readonly states: MorphState[] = [];
  private readonly arena: RangeAllocator;
  /** Returns the number of retained morph-weight storage arenas. */
  get count(): number {
    return this.arena.count;
  }
  /** Initializes shared per-instance morph weights and recyclable ranges. */
  constructor(readonly capacity = 65536) {
    this.arena = new RangeAllocator(capacity);
    this.data = new Float32Array(capacity);
  }
  /** Compact state IDs on the cold path; live views/arena offsets remain unchanged. */
  releaseUnused(world: import("../ecs/World").World): void {
    const used = new Set<number>();
    for (let e = 0; e < world.nextEntity; e++)
      if (world.alive[e] && world.morphs.has[e])
        used.add(world.morphs.stateId[e]!);
    const remap = new Map<number, number>();
    let count = 0;
    for (let id = 0; id < this.states.length; id++) {
      const state = this.states[id]!;
      if (!used.has(id)) {
        this.arena.release(state.weightOffset);
        continue;
      }
      remap.set(id, count);
      this.states[count++] = state;
    }
    this.states.length = count;
    for (let e = 0; e < world.nextEntity; e++)
      if (world.alive[e] && world.morphs.has[e])
        world.morphs.stateId[e] = remap.get(world.morphs.stateId[e]!)!;
  }
  /** Reserves a weight range for one morph instance, copies initial values and marks it dirty. */
  create(targetCount: number, initial: ArrayLike<number> = []): number {
    if (!Number.isInteger(targetCount) || targetCount < 1)
      throw new Error("Morph weight capacity exceeded");
    if (initial.length && initial.length !== targetCount)
      throw new Error("Invalid default morph weights");
    for (let i = 0; i < initial.length; i++)
      if (!Number.isFinite(initial[i])) throw new Error("Invalid morph weight");
    const offset = this.arena.allocate(targetCount),
      weights = this.data.subarray(offset, offset + targetCount);
    weights.fill(0);
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
