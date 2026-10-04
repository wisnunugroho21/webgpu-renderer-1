import { EntityHandle } from "../ecs/Entity";
import { Animator, MorphState } from "../animation/Animator";
import { World } from "../ecs/World";
import { AnimationSystem } from "../ecs/systems/AnimationSystem";
import { SkeletonRegistry } from "../animation/skinning/SkeletonRegistry";
import { RuntimeAsset } from "./gltf/RuntimeAsset";
import { UploadedAsset } from "./gltf/instantiate";
/** Application-owned scene instances. Retained identities validate generations before touching recycled slots. */
export class AssetInstances {
  private readonly entries = new Map<
    string,
    {
      entities: Map<number, EntityHandle>;
      leases: (() => void)[];
      animators: Set<Animator>;
      morphs: Set<MorphState>;
    }
  >();
  constructor(
    private readonly world: World,
    private readonly animations: AnimationSystem,
    private readonly skeletons: SkeletonRegistry,
  ) {}
  add(url: string, start: number, end: number, release: () => void): void {
    this.addEntities(
      url,
      Array.from({ length: end - start }, (_, i) =>
        this.world.handle(start + i),
      ),
      release,
    );
  }
  addEntities(
    url: string,
    entities: readonly EntityHandle[],
    release: () => void,
  ): void {
    let entry = this.entries.get(url);
    if (!entry) {
      entry = {
        entities: new Map(),
        leases: [],
        animators: new Set(),
        morphs: new Set(),
      };
      this.entries.set(url, entry);
    }
    for (const handle of entities) {
      const e = this.world.require(handle);
      entry.entities.set(e, handle);
      if (this.world.animators.has[e])
        entry.animators.add(
          this.animations.animators[this.world.animators.animatorId[e]!]!,
        );
      if (this.world.morphs.has[e])
        entry.morphs.add(
          this.animations.morphStates[this.world.morphs.stateId[e]!]!,
        );
    }
    entry.leases.push(release);
  }
  /** Veto external consumers before changing anything; custom attachments require explicit detachment. */
  assertCanUnload(url: string, uploaded: UploadedAsset): void {
    const world = this.world,
      own = new Set(
        Array.from(this.entries.get(url)?.entities.values() ?? [])
          .filter((handle) => world.resolve(handle) !== null)
          .map((handle) => handle.index),
      );
    const meshes = new Set(uploaded.meshIds.flat()),
      materials = new Set([...uploaded.materialIds, uploaded.defaultMaterial]);
    const skins = new Set<number>(),
      morphs = new Set<number>(),
      animators = new Set<number>();
    const entry = this.entries.get(url);
    for (let id = 0; id < this.skeletons.instances.length; id++)
      if (own.has(this.skeletons.instances[id]!.meshEntity)) skins.add(id);
    for (let id = 0; id < this.animations.animators.length; id++)
      if (entry?.animators.has(this.animations.animators[id]!))
        animators.add(id);
    for (let id = 0; id < this.animations.morphStates.length; id++)
      if (entry?.morphs.has(this.animations.morphStates[id]!)) morphs.add(id);
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
        this.skeletons.instances[id]!.jointEntities.some((e) => own.has(e))
      )
        throw new Error("Asset joints are referenced by an external skeleton");
  }
  detach(url: string, asset: RuntimeAsset): void {
    const entry = this.entries.get(url);
    if (entry) {
      for (const handle of entry.entities.values()) this.world.destroy(handle);
      for (const release of entry.leases) release();
      this.entries.delete(url);
    }
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
  rollback(start: number, asset: RuntimeAsset): void {
    for (let e = start; e < this.world.nextEntity; e++) this.world.destroy(e);
    this.animations.releaseUnused(this.world);
    this.skeletons.releaseUnused(this.world, asset);
  }
}
