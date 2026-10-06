import * as temporalLayout from "./TemporalLayout";
import type { RenderWorld } from "../RenderWorld";
import type { MaterialManager } from "../materials/MaterialManager";
// Resolve immutable ABI widths once, outside object packing/upload loops.
const { MOTION_OBJECT_WORDS } = temporalLayout;
/** Fixed identity table and packed previous pose, independent of compact extraction order. */
export class MotionHistory {
  readonly current: Float32Array;
  readonly previous: Float32Array;
  readonly currentWords: Uint32Array;
  readonly previousWords: Uint32Array;
  private readonly saved: Float32Array;
  private readonly ids: Uint32Array;
  private readonly generations: Float64Array;
  private readonly materialGenerations: Float64Array;
  private readonly meshes: Uint32Array;
  private readonly skins: Int32Array;
  private readonly morphs: Int32Array;
  private readonly table: Int32Array;
  private readonly mask: number;
  readonly jointWord: number;
  readonly morphWord: number;
  valid = false;
  /** Allocate seven vec4 object rows plus retained shared palette/weight ranges once. */
  constructor(
    readonly capacity: number,
    jointCapacity: number,
    morphCapacity: number,
  ) {
    this.jointWord = capacity * MOTION_OBJECT_WORDS;
    this.morphWord = this.jointWord + jointCapacity * 16;
    this.current = new Float32Array(capacity * MOTION_OBJECT_WORDS);
    this.previous = new Float32Array(
      this.morphWord + Math.max(4, morphCapacity),
    );
    this.currentWords = new Uint32Array(this.current.buffer);
    this.previousWords = new Uint32Array(this.previous.buffer);
    this.saved = new Float32Array(capacity * MOTION_OBJECT_WORDS);
    this.ids = new Uint32Array(capacity);
    this.generations = new Float64Array(capacity);
    this.materialGenerations = new Float64Array(capacity);
    this.meshes = new Uint32Array(capacity);
    this.skins = new Int32Array(capacity);
    this.morphs = new Int32Array(capacity);
    let size = 1;
    while (size < capacity * 2) size *= 2;
    this.table = new Int32Array(size).fill(-1);
    this.mask = size - 1;
  }
  /** Invalidate identity lookup after camera cuts, resize or a new GPU lifetime. */
  reset(): void {
    this.valid = false;
    this.table.fill(-1);
  }
  /** Pack current draws and remap compatible previous identities into current object slots. */
  prepare(world: RenderWorld, materials: MaterialManager): void {
    for (let i = 0; i < world.count; i++) {
      const o = i * MOTION_OBJECT_WORDS;
      this.current.set(world.matrices.subarray(i * 16, i * 16 + 16), o);
      const w = this.currentWords;
      w[o + 16] = i;
      w[o + 17] = world.materialId[i]!;
      w[o + 18] = world.jointOffset[i]!;
      w[o + 19] = world.jointCounts[i]!;
      w[o + 20] = world.morphOffset[i]!;
      w[o + 21] = world.morphCounts[i]!;
      w[o + 22] = i;
      w[o + 23] = world.flags[i]!;
      w[o + 24] = 0;
      w[o + 25] = 0;
      w[o + 26] = world.meshId[i]!;
      w[o + 27] = 0;
      let slot = (Math.imul(world.entityId[i]!, 0x9e3779b1) >>> 0) & this.mask;
      while (
        this.table[slot] !== -1 &&
        this.ids[this.table[slot]!] !== world.entityId[i]
      )
        slot = (slot + 1) & this.mask;
      const prior = this.table[slot]!;
      const compatible =
        this.valid &&
        prior >= 0 &&
        this.generations[prior] === world.entityGeneration[i] &&
        this.meshes[prior] === world.meshId[i] &&
        this.materialGenerations[prior] ===
          materials.generations[world.materialId[i]!] &&
        this.skins[prior] === world.skinInstanceId[i] &&
        this.morphs[prior] === world.morphStateId[i] &&
        this.saved[prior * MOTION_OBJECT_WORDS + 17] === this.current[o + 17];
      this.previous.set(
        compatible
          ? this.saved.subarray(
              prior * MOTION_OBJECT_WORDS,
              prior * MOTION_OBJECT_WORDS + MOTION_OBJECT_WORDS,
            )
          : this.current.subarray(o, o + MOTION_OBJECT_WORDS),
        o,
      );
      this.previousWords[o + 27] = 0;
      w[o + 27] = compatible ? 1 : 0;
    }
  }
  /** Save CPU identities and object poses after encoding; shared palettes are snapshotted by GPU copies. */
  capture(world: RenderWorld, materials: MaterialManager): void {
    this.saved.set(this.current.subarray(0, world.count * MOTION_OBJECT_WORDS));
    this.table.fill(-1);
    for (let i = 0; i < world.count; i++) {
      const id = world.entityId[i]!;
      this.ids[i] = id;
      this.generations[i] = world.entityGeneration[i]!;
      this.materialGenerations[i] =
        materials.generations[world.materialId[i]!]!;
      this.meshes[i] = world.meshId[i]!;
      this.skins[i] = world.skinInstanceId[i]!;
      this.morphs[i] = world.morphStateId[i]!;
      let slot = (Math.imul(id, 0x9e3779b1) >>> 0) & this.mask;
      while (this.table[slot] !== -1) slot = (slot + 1) & this.mask;
      this.table[slot] = i;
    }
    this.valid = true;
  }
}
