import { BatchBuilder } from "./BatchBuilder";
import { RenderQueue } from "./RenderQueue";
import {
  BLEND_PIPELINE_OFFSET,
  MATERIAL_PIPELINE_VARIANTS,
} from "./pipelines/ColorPipelineLayout";

/** Already sorted effect streams; indices address persistent records, ranges address their order tables. */
export interface TransparencyEffects {
  readonly order: Uint32Array;
  readonly depths: Float32Array;
  readonly alphaCount: number;
  readonly trailOrder: Uint32Array;
  readonly trailDepths: Float32Array;
  readonly trailAlphaCount: number;
}

/** Merge mesh centers, analytic billboard centers and ribbon midpoints without hot allocations.
 * Kind 0 is a mesh batch slice, 1 a billboard range, 2 a ribbon range.
 * Equal depths retain mesh/billboard/ribbon precedence and stable order within each stream. */
export class UnifiedTransparency {
  count = 0;
  readonly kind: Uint8Array;
  readonly batch: Uint32Array;
  readonly first: Uint32Array;
  readonly length: Uint32Array;

  /** Reserve worst-case alternating runs once, including indirect LOD candidate draws. */
  constructor(capacity: number) {
    this.kind = new Uint8Array(capacity);
    this.batch = new Uint32Array(capacity);
    this.first = new Uint32Array(capacity);
    this.length = new Uint32Array(capacity);
  }

  /** Coalesce adjacent ranges only when their source and mesh batch remain compatible. */
  private append(kind: number, batch: number, first: number, count = 1): void {
    const previous = this.count - 1;
    if (
      previous >= 0 &&
      this.kind[previous] === kind &&
      this.batch[previous] === batch &&
      this.first[previous]! + this.length[previous]! === first
    ) {
      this.length[previous]! += count;
      return;
    }
    if (this.count === this.kind.length)
      throw new Error("Unified transparency capacity exceeded");
    const run = this.count++;
    this.kind[run] = kind;
    this.batch[run] = batch;
    this.first[run] = first;
    this.length[run] = count;
  }

  /** Linear merge preserves each mesh instance rank and splits instancing only at effect boundaries. */
  build(
    queue: RenderQueue,
    batches: BatchBuilder,
    effects: TransparencyEffects,
  ): void {
    this.count = 0;
    let mesh = 0,
      offset = 0,
      billboard = 0,
      ribbon = 0;
    while (
      mesh < batches.count &&
      batches.pipeline[mesh]! % MATERIAL_PIPELINE_VARIANTS <
        BLEND_PIPELINE_OFFSET
    )
      mesh++;
    while (
      mesh < batches.count ||
      billboard < effects.alphaCount ||
      ribbon < effects.trailAlphaCount
    ) {
      if (
        billboard === effects.alphaCount &&
        ribbon === effects.trailAlphaCount
      ) {
        if (mesh < batches.count) {
          this.append(0, mesh, offset, batches.instanceCount[mesh]! - offset);
          mesh++;
          offset = 0;
          continue;
        }
      }
      if (mesh === batches.count && ribbon === effects.trailAlphaCount) {
        this.append(1, 0, billboard, effects.alphaCount - billboard);
        break;
      }
      if (mesh === batches.count && billboard === effects.alphaCount) {
        this.append(2, 0, ribbon, effects.trailAlphaCount - ribbon);
        break;
      }
      const meshDepth =
        mesh < batches.count
          ? queue.depth[queue.order[batches.queueFirst[mesh]! + offset]!]!
          : -Infinity;
      const billboardDepth =
        billboard < effects.alphaCount
          ? effects.depths[effects.order[billboard]!]!
          : -Infinity;
      const ribbonDepth =
        ribbon < effects.trailAlphaCount
          ? effects.trailDepths[effects.trailOrder[ribbon]!]!
          : -Infinity;
      if (
        mesh < batches.count &&
        meshDepth >= billboardDepth &&
        meshDepth >= ribbonDepth
      ) {
        const lastDepth =
          queue.depth[
            queue.order[
              batches.queueFirst[mesh]! + batches.instanceCount[mesh]! - 1
            ]!
          ]!;
        const count =
          lastDepth >= billboardDepth && lastDepth >= ribbonDepth
            ? batches.instanceCount[mesh]! - offset
            : 1;
        this.append(0, mesh, offset, count);
        offset += count;
        if (offset === batches.instanceCount[mesh]) {
          mesh++;
          offset = 0;
        }
      } else if (
        billboard < effects.alphaCount &&
        billboardDepth >= ribbonDepth
      ) {
        const lastDepth =
          effects.depths[effects.order[effects.alphaCount - 1]!]!;
        const count =
          lastDepth > meshDepth && lastDepth >= ribbonDepth
            ? effects.alphaCount - billboard
            : 1;
        this.append(1, 0, billboard, count);
        billboard += count;
      } else {
        const lastDepth =
          effects.trailDepths[
            effects.trailOrder[effects.trailAlphaCount - 1]!
          ]!;
        const count =
          lastDepth > meshDepth && lastDepth > billboardDepth
            ? effects.trailAlphaCount - ribbon
            : 1;
        this.append(2, 0, ribbon, count);
        ribbon += count;
      }
    }
  }
}
