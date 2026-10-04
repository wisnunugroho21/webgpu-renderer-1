import { Mat4 } from "../../math/Mat4";
import { World } from "../World";
import { SkeletonRegistry } from "../../animation/skinning/SkeletonRegistry";
/** Column-vector convention: inverse(meshWorld) * jointWorld * inverseBind.
 * Must run after animation sampling and transform hierarchy updates.
 */
export class SkeletonSystem {
  activeSkeletons = 0;
  jointCount = 0;
  updatedJoints = 0;
  private readonly mesh = Mat4.create();
  private readonly localJoint = Mat4.create();
  update(world: World, registry: SkeletonRegistry): void {
    this.activeSkeletons = this.jointCount = this.updatedJoints = 0;
    const transforms = world.transforms,
      matrices = transforms.worldMatrices;
    for (const instance of registry.instances) {
      if (
        !world.alive[instance.meshEntity] ||
        (instance.meshGeneration !== undefined &&
          world.generation[instance.meshEntity] !== instance.meshGeneration) ||
        !transforms.has[instance.meshEntity]
      )
        continue;
      this.activeSkeletons++;
      this.jointCount += instance.jointCount;
      let meshChanged = false;
      for (let k = 0; k < 16; k++) {
        this.mesh[k] = matrices[instance.meshEntity * 16 + k]!;
        if (this.mesh[k] !== instance.meshWorld[k]) meshChanged = true;
      }
      if (meshChanged) Mat4.invert(instance.inverseMesh, this.mesh);
      for (let j = 0; j < instance.jointCount; j++) {
        const entity = instance.jointEntities[j]!;
        if (
          !world.alive[entity] ||
          (instance.jointGenerations &&
            world.generation[entity] !== instance.jointGenerations[j]) ||
          !transforms.has[entity]
        )
          throw new Error("Skeleton joint entity removed");
        const pose = instance.poseViews[j]!;
        let changed = meshChanged;
        // One mismatch is enough; changed joints still copy the complete pose.
        // A changed mesh already requires every palette entry to be recomputed.
        if (!changed)
          for (let k = 0; k < 16; k++)
            if (pose[k] !== matrices[entity * 16 + k]) {
              changed = true;
              break;
            }
        if (!changed) continue;
        for (let k = 0; k < 16; k++) pose[k] = matrices[entity * 16 + k]!;
        Mat4.multiply(this.localJoint, instance.inverseMesh, pose);
        Mat4.multiply(
          instance.matrixViews[j]!,
          this.localJoint,
          instance.asset.bindViews[j]!,
        );
        instance.dirtyJoints[j] = 1;
        this.updatedJoints++;
      }
      instance.meshWorld.set(this.mesh);
    }
  }
}
