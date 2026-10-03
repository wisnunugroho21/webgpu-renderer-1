import { RuntimeAsset } from "../../assets/gltf/RuntimeAsset";
import { World } from "../../ecs/World";
import { MeshManager } from "../../rendering/MeshManager";
import { SkeletonAsset } from "./SkeletonAsset";
import { SkeletonInstance } from "./SkeletonInstance";
export class SkeletonRegistry {
  jointCount = 0;
  constructor(readonly jointCapacity = 65536) {}
  private readonly cache = new WeakMap<RuntimeAsset, SkeletonAsset[]>();
  readonly assets: SkeletonAsset[] = [];
  readonly instances: SkeletonInstance[] = [];
  attach(
    asset: RuntimeAsset,
    entities: Int32Array,
    world: World,
    meshes: MeshManager,
  ): void {
    let skeletons = this.cache.get(asset);
    if (!skeletons) {
      skeletons = asset.skins.map((s) => new SkeletonAsset(s, asset.nodes));
      this.cache.set(asset, skeletons);
      this.assets.push(...skeletons);
    }
    for (let node = 0; node < entities.length; node++) {
      const e = entities[node]!,
        data = asset.nodes[node]!;
      if (e < 0 || data.skin < 0) continue;
      const skeleton = skeletons[data.skin];
      if (!skeleton) throw new Error("Unknown skin");
      if (this.jointCount + skeleton.jointCount > this.jointCapacity)
        throw new Error("Shared joint capacity exceeded");
      const instance = new SkeletonInstance(skeleton, e, entities);
      instance.jointOffset = this.jointCount;
      this.jointCount += instance.jointCount;
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
