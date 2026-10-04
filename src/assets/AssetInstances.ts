import { EntityHandle } from "../ecs/Entity";
import { Animator, MorphState } from "../animation/Animator";
import { World } from "../ecs/World";
import { AnimationSystem } from "../ecs/systems/AnimationSystem";
import { SkeletonRegistry } from "../animation/skinning/SkeletonRegistry";
import { RuntimeAsset } from "./gltf/RuntimeAsset";
import { UploadedAsset } from "./gltf/instantiate";
/** A cold ownership record includes primitive children as well as authored nodes. */
export interface InstanceLifetime {
  readonly entities: readonly EntityHandle[];
  readonly animator: Animator | undefined;
  readonly disposed: boolean;
  /** Releases this owner or scene lifetime according to its independent ownership contract. */
  dispose(): void;
}
interface InstanceRecord {
  entities: readonly EntityHandle[];
  release: () => void;
  animators: Set<Animator>;
  morphs: Set<MorphState>;
  disposed: boolean;
}
/** Application-owned scene instances; shared assets outlive individual scene lifetimes. */
export class AssetInstances {
  private readonly entries = new Map<string, Set<InstanceRecord>>();
  /** Initializes scene leases, shared-resource references and entity ownership. */
  constructor(
    private readonly world: World,
    private readonly animations: AnimationSystem,
    private readonly skeletons: SkeletonRegistry,
  ) {}
  /** Publishes a scene lease and records its shared asset references for later independent despawning. */
  add(url: string, start: number, end: number, release: () => void): void {
    this.addEntities(
      url,
      Array.from({ length: end - start }, (_, i) =>
        /** Delegates this operation to this.world.handle. */ this.world.handle(
          start + i,
        ),
      ),
      release,
    );
  }
  /** Tracks entity ownership and generations for one instantiated scene. */
  addEntities(
    url: string,
    entities: readonly EntityHandle[],
    release: () => void,
    asset?: RuntimeAsset,
  ): InstanceLifetime {
    let entries = this.entries.get(url);
    if (!entries) this.entries.set(url, (entries = new Set()));
    const record: InstanceRecord = {
      entities: Object.freeze(Array.from(entities)),
      release,
      animators: new Set(),
      morphs: new Set(),
      disposed: false,
    };
    for (const handle of entities) {
      const e = this.world.require(handle);
      if (this.world.animators.has[e])
        record.animators.add(
          this.animations.animators[this.world.animators.animatorId[e]!]!,
        );
      if (this.world.morphs.has[e])
        record.morphs.add(
          this.animations.morphStates[this.world.morphs.stateId[e]!]!,
        );
    }
    entries.add(record);
    return Object.freeze({
      entities: record.entities,
      animator: record.animators.values().next().value,
      /** Reports whether this independent scene lifetime has detached its entities. */
      get disposed() {
        return record.disposed;
      },
      /** Releases owned scene leases, shared-resource references and entity ownership and prevents its remaining state from being used. */
      dispose: () => {
        if (record.disposed) return;
        // Shared mesh/material references are allowed; entity-owned bindings are not.
        this.assertConsumers([record]);
        this.retire(record);
        entries.delete(record);
        if (!entries.size) this.entries.delete(url);
        this.animations.releaseUnused(this.world);
        this.skeletons.releaseUnused(this.world, asset);
      },
    });
  }
  /** Retires a scene lease once and drops its tracked ownership references. */
  private retire(record: InstanceRecord): void {
    for (const handle of record.entities) this.world.destroy(handle);
    record.release();
    record.disposed = true;
  }
  /** Rejects retirement while surviving consumers still depend on the asset resources. */
  private assertConsumers(
    records: Iterable<InstanceRecord>,
    uploaded?: UploadedAsset,
  ): void {
    const list = Array.from(records),
      world = this.world;
    const own = new Set(
      list
        .flatMap((record) => /** Returns record entities. */ record.entities)
        .filter(
          (handle) =>
            /** Evaluates the world.resolve(handle) !== null condition. */ world.resolve(
              handle,
            ) !== null,
        )
        .map((handle) => /** Returns handle index. */ handle.index),
    );
    const meshes = new Set(uploaded?.meshIds.flat() ?? []),
      materials = new Set(
        uploaded ? [...uploaded.materialIds, uploaded.defaultMaterial] : [],
      );
    const skins = new Set<number>(),
      morphs = new Set<number>(),
      animators = new Set<number>();
    for (let id = 0; id < this.skeletons.instances.length; id++)
      if (own.has(this.skeletons.instances[id]!.meshEntity)) skins.add(id);
    for (let id = 0; id < this.animations.animators.length; id++)
      if (
        list.some((record) =>
          /** Delegates this operation to record.animators.has. */ record.animators.has(
            this.animations.animators[id]!,
          ),
        )
      )
        animators.add(id);
    for (let id = 0; id < this.animations.morphStates.length; id++)
      if (
        list.some((record) =>
          /** Delegates this operation to record.morphs.has. */ record.morphs.has(
            this.animations.morphStates[id]!,
          ),
        )
      )
        morphs.add(id);
    const usedSkins = new Set<number>();
    for (let e = 0; e < world.nextEntity; e++)
      if (world.alive[e] && world.skins.has[e])
        usedSkins.add(world.skins.instanceId[e]!);
    for (let e = 0; e < world.nextEntity; e++) {
      if (!world.alive[e] || own.has(e)) continue;
      if (
        (world.meshes.has[e] &&
          (meshes.has(world.meshes.meshId[e]!) ||
            materials.has(world.meshes.materialId[e]!))) ||
        (world.transforms.has[e] && own.has(world.transforms.parent[e]!)) ||
        (world.skins.has[e] && skins.has(world.skins.instanceId[e]!)) ||
        (world.morphs.has[e] && morphs.has(world.morphs.stateId[e]!)) ||
        (world.animators.has[e] &&
          animators.has(world.animators.animatorId[e]!))
      )
        throw new Error(
          "Asset is referenced by an external entity; detach it before unloading",
        );
    }
    for (let id = 0; id < this.skeletons.instances.length; id++)
      if (
        usedSkins.has(id) &&
        !skins.has(id) &&
        this.skeletons.instances[id]!.jointEntities.some((e) =>
          /** Delegates this operation to own.has. */ own.has(e),
        )
      )
        throw new Error("Asset joints are referenced by an external skeleton");
  }
  /** URL unload still releases every instance, after one aggregate consumer veto. */
  assertCanUnload(url: string, uploaded: UploadedAsset): void {
    this.assertConsumers(this.entries.get(url) ?? [], uploaded);
  }
  /** Removes owned entities and compacts animation/morph/skeleton registry references safely. */
  detach(url: string, asset: RuntimeAsset): void {
    for (const record of this.entries.get(url) ?? []) this.retire(record);
    this.entries.delete(url);
    this.animations.releaseUnused(this.world);
    this.skeletons.releaseUnused(this.world, asset);
  }
  /** Failed instantiation may have allocated entities/controllers before rejecting. */
  rollbackEntities(
    entities: readonly EntityHandle[],
    asset: RuntimeAsset,
  ): void {
    for (const entity of entities) this.world.destroy(entity);
    this.animations.releaseUnused(this.world);
    this.skeletons.releaseUnused(this.world, asset);
  }
  /** Reverts a failed instantiation transaction and restores registry/material ownership. */
  rollback(start: number, asset: RuntimeAsset): void {
    for (let e = start; e < this.world.nextEntity; e++) this.world.destroy(e);
    this.animations.releaseUnused(this.world);
    this.skeletons.releaseUnused(this.world, asset);
  }
}
