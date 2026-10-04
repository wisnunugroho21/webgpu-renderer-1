import { World } from "../World";
import { MeshManager } from "../../rendering/MeshManager";
import { SkeletonRegistry } from "../../animation/skinning/SkeletonRegistry";
import { MorphStatePool } from "../../animation/MorphStatePool";
/** Conservative bounds from cold-path delta extrema and current joint palettes.
 * Positive normalized skin weights make each deformed point a convex combination
 * of joint-transformed points, enclosed by the union of transformed expanded boxes.
 * No per-frame vertex traversal or CPU deformation is required.
 */
export class AnimatedBoundsSystem {
  updatedObjects = 0;
  jointBoxes = 0;
  private readonly min = new Float32Array(3);
  private readonly max = new Float32Array(3);
  private readonly unionMin = new Float32Array(3);
  private readonly unionMax = new Float32Array(3);
  update(
    world: World,
    meshes: MeshManager,
    skeletons: SkeletonRegistry,
    morphs: MorphStatePool,
  ): void {
    this.updatedObjects = this.jointBoxes = 0;
    for (let e = 0; e < world.nextEntity; e++) {
      if (
        !world.alive[e] ||
        !world.meshes.has[e] ||
        !world.bounds.has[e] ||
        (!world.skins.has[e] && !world.morphs.has[e])
      )
        continue;
      const mesh = meshes.get(world.meshes.meshId[e]!);
      if (!mesh.bounds) throw new Error("Animated mesh has no base bounds");
      this.min.set(mesh.bounds.min);
      this.max.set(mesh.bounds.max);
      const state = world.morphs.has[e]
        ? morphs.states[world.morphs.stateId[e]!]
        : undefined;
      if (state && mesh.morph) {
        if (state.targetCount !== mesh.morph.targetCount)
          throw new Error("Morph bounds target count mismatch");
        for (let target = 0; target < state.targetCount; target++)
          for (let axis = 0; axis < 3; axis++) {
            const a =
                state.weights[target]! *
                mesh.morph.positionMin[target * 3 + axis]!,
              b =
                state.weights[target]! *
                mesh.morph.positionMax[target * 3 + axis]!;
            this.min[axis]! += Math.min(a, b);
            this.max[axis]! += Math.max(a, b);
          }
      }
      const instance = world.skins.has[e]
        ? skeletons.instances[world.skins.instanceId[e]!]
        : undefined;
      if (instance) {
        this.unionMin.fill(Infinity);
        this.unionMax.fill(-Infinity);
        for (let joint = 0; joint < instance.jointCount; joint++) {
          const m = instance.matrixViews[joint]!;
          this.jointBoxes++;
          for (let r = 0; r < 3; r++) {
            // Unroll the three affine axes. Sign selection preserves the original
            // sum order and conservative extrema without six Math.min/max calls.
            const a = m[r]!,
              b = m[4 + r]!,
              c = m[8 + r]!;
            let lo = m[12 + r]!,
              hi = lo;
            lo += a * (a >= 0 ? this.min[0]! : this.max[0]!);
            hi += a * (a >= 0 ? this.max[0]! : this.min[0]!);
            lo += b * (b >= 0 ? this.min[1]! : this.max[1]!);
            hi += b * (b >= 0 ? this.max[1]! : this.min[1]!);
            lo += c * (c >= 0 ? this.min[2]! : this.max[2]!);
            hi += c * (c >= 0 ? this.max[2]! : this.min[2]!);
            this.unionMin[r] = Math.min(this.unionMin[r]!, lo);
            this.unionMax[r] = Math.max(this.unionMax[r]!, hi);
          }
        }
        this.min.set(this.unionMin);
        this.max.set(this.unionMax);
      }
      for (let axis = 0; axis < 3; axis++) {
        const padding =
          1e-5 *
          Math.max(1, Math.abs(this.min[axis]!), Math.abs(this.max[axis]!));
        this.min[axis]! -= padding;
        this.max[axis]! += padding;
      }
      world.bounds.setAABB(e, this.min, this.max);
      this.updatedObjects++;
    }
  }
}
