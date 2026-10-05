import {
  targetDescriptor,
  TransientTargetPool,
  type TargetLease,
} from "../../gpu/TransientTargetPool";
import { textureMemory } from "../../gpu/TextureMemory";
/** Inclusive schedule indices: resources touched by the same pass always overlap. */
export interface ResourceLifetime {
  readonly name: string;
  readonly first: number;
  readonly last: number;
  readonly imported: boolean;
  readonly exported: boolean;
}
export interface TransientTexture {
  readonly descriptor: GPUTextureDescriptor;
  /** The first writer must clear or fully overwrite; pooled contents are never preserved. */
  readonly initialization: "clear" | "full-write";
  readonly exported?: boolean;
}
export interface TargetSlot {
  readonly descriptor: GPUTextureDescriptor;
  readonly resources: readonly string[];
}
export interface TargetPlan {
  readonly slots: readonly TargetSlot[];
  readonly logicalBytes: number;
  readonly physicalBytes: number;
  readonly peakLiveBytes: number;
}
/** Greedy interval coloring for exact-compatible targets; imported/persistent resources never enter this plan. */
export function planTargets(
  lifetimes: ReadonlyMap<string, ResourceLifetime>,
  definitions: ReadonlyMap<string, TransientTexture>,
): TargetPlan {
  const slots: {
    descriptor: GPUTextureDescriptor;
    key: string;
    resources: string[];
    last: number;
  }[] = [];
  const intervals = Array.from(definitions, ([name, definition]) => {
    // Resolve every declared target against a real producer and its compiled lifetime.
    const lifetime = lifetimes.get(name);
    if (!lifetime || lifetime.imported)
      throw new Error(`Transient target ${name} requires a graph producer`);
    return {
      name,
      definition,
      lifetime,
      ...targetDescriptor(definition.descriptor),
    };
  }).sort((a, b) => {
    // Declaration-order ties remain stable, while coloring follows actual execution order.
    return a.lifetime.first - b.lifetime.first;
  });
  let logicalBytes = 0,
    physicalBytes = 0,
    peakLiveBytes = 0;
  for (const interval of intervals) {
    const bytes = textureMemory(interval.descriptor).bytes;
    logicalBytes += bytes;
    let slot = slots.find((candidate) => {
      // An earlier target's final consumer must finish before the next target's first write.
      return (
        candidate.key === interval.key &&
        candidate.last < interval.lifetime.first
      );
    });
    if (!slot) {
      slot = {
        descriptor: interval.descriptor,
        key: interval.key,
        resources: [],
        last: -1,
      };
      slots.push(slot);
      physicalBytes += bytes;
    }
    slot.resources.push(interval.name);
    slot.last = interval.lifetime.last;
  }
  for (const interval of intervals) {
    let live = 0;
    for (const other of intervals)
      if (
        other.lifetime.first <= interval.lifetime.first &&
        other.lifetime.last >= interval.lifetime.first
      )
        live += textureMemory(other.descriptor).bytes;
    peakLiveBytes = Math.max(peakLiveBytes, live);
  }
  return Object.freeze({
    slots: Object.freeze(
      slots.map((slot) => {
        // Publish immutable assignments independently of internal coloring scratch.
        return Object.freeze({
          descriptor: slot.descriptor,
          resources: Object.freeze(slot.resources),
        });
      }),
    ),
    logicalBytes,
    physicalBytes,
    peakLiveBytes,
  });
}
/** Prepared physical leases and logical views; bind groups should capture these once during cold setup. */
export class RenderGraphTargets {
  private readonly leases: TargetLease[] = [];
  private readonly targets = new Map<
    string,
    Readonly<Pick<TargetLease, "texture" | "view">>
  >();
  private disposed = false;
  /** Acquire one physical lease per colored slot and roll back every lease on preparation failure. */
  constructor(pool: TransientTargetPool, plan: TargetPlan) {
    try {
      for (const slot of plan.slots) {
        const lease = pool.acquire(slot.descriptor);
        this.leases.push(lease);
        const target = Object.freeze({
          texture: lease.texture,
          view: lease.view,
        });
        for (const name of slot.resources) this.targets.set(name, target);
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  /** Resolve a logical target without allocating GPU objects; unknown/disposed targets fail explicitly. */
  get(name: string): Readonly<Pick<TargetLease, "texture" | "view">> {
    const target = this.targets.get(name);
    if (this.disposed || !target)
      throw new Error(`Unknown graph target ${name}`);
    return target;
  }
  /** Release each physical slot once, even when several logical resources share it. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const lease of this.leases) lease.release();
    this.targets.clear();
  }
}
