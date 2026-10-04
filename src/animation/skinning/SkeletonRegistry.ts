import { RangeAllocator } from "../../assets/RangeAllocator";
import { RuntimeAsset } from "../../assets/gltf/RuntimeAsset";
import { World } from "../../ecs/World";
import { MeshManager } from "../../rendering/MeshManager";
import { SkeletonAsset } from "./SkeletonAsset";
import { SkeletonInstance } from "./SkeletonInstance";
export class SkeletonRegistry {
  jointCount = 0;
  private readonly arena: RangeAllocator;
  /** Initializes shared skeleton assets and per-mesh palettes. */
  constructor(readonly jointCapacity = 65536) {
    this.arena = new RangeAllocator(jointCapacity);
  }
  private readonly cache = new WeakMap<RuntimeAsset, SkeletonAsset[]>();
  readonly assets: SkeletonAsset[] = [];
  readonly instances: SkeletonInstance[] = [];
  /** Retire unused instances and remap ECS IDs without moving surviving palette offsets. */
  releaseUnused(world: World, asset?: RuntimeAsset): void {
    const used = new Set<number>();
    for (let e = 0; e < world.nextEntity; e++)
      if (world.alive[e] && world.skins.has[e])
        used.add(world.skins.instanceId[e]!);
    const remap = new Map<number, number>();
    let count = 0;
    for (let id = 0; id < this.instances.length; id++) {
      const instance = this.instances[id]!;
      if (!used.has(id)) {
        this.arena.release(instance.jointOffset);
        continue;
      }
      remap.set(id, count);
      this.instances[count++] = instance;
    }
    this.instances.length = count;
    this.jointCount = this.arena.count;
    for (let e = 0; e < world.nextEntity; e++)
      if (world.alive[e] && world.skins.has[e])
        world.skins.instanceId[e] = remap.get(world.skins.instanceId[e]!)!;
    if (asset) {
      const cached = this.cache.get(asset);
      if (
        cached &&
        !this.instances.some((instance) =>
          /** Delegates this operation to cached.includes. */ cached.includes(
            instance.asset,
          ),
        )
      ) {
        this.cache.delete(asset);
        for (let i = this.assets.length - 1; i >= 0; i--)
          if (cached.includes(this.assets[i]!)) this.assets.splice(i, 1);
      }
    }
  }
  /** Attaches one skeleton instance to a mesh entity with generation-aware joint references and shared palette storage. */
  attach(
    asset: RuntimeAsset,
    entities: Int32Array,
    world: World,
    meshes: MeshManager,
  ): void {
    let skeletons = this.cache.get(asset);
    if (!skeletons) {
      skeletons = asset.skins.map(
        (s) =>
          /** Creates SkeletonAsset storage for this operation. */ new SkeletonAsset(
            s,
            asset.nodes,
          ),
      );
      this.cache.set(asset, skeletons);
      this.assets.push(...skeletons);
    }
    for (let node = 0; node < entities.length; node++) {
      const e = entities[node]!,
        data = asset.nodes[node]!;
      if (e < 0 || data.skin < 0) continue;
      const skeleton = skeletons[data.skin];
      if (!skeleton) throw new Error("Unknown skin");

      const instance = new SkeletonInstance(skeleton, e, entities, world);
      instance.jointOffset = this.arena.allocate(instance.jointCount);
      this.jointCount = this.arena.count;
      const id = this.instances.push(instance) - 1;
      world.skins.add(e);
      world.skins.instanceId[e] = id;
      for (
        let child = world.transforms.firstChild[e]!;
        child !== -1;
        child = world.transforms.nextSibling[child]!
      )
        if (world.meshes.has[child]) {
          const skin = meshes.get(world.meshes.meshId[child]!).skin;
          if (!skin) throw new Error("Skinned mesh has no JOINTS_0/WEIGHTS_0");
          skin.validateJointCount(skeleton.jointCount);
          world.skins.add(child);
          world.skins.instanceId[child] = id;
        }
    }
  }
}
