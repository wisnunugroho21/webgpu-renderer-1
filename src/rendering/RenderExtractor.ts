import { MorphStatePool } from "../animation/MorphStatePool";
import { SkeletonRegistry } from "../animation/skinning/SkeletonRegistry";
import { World } from "../ecs/World";
import { RenderWorld } from "./RenderWorld";
import { RenderFlags } from "./RenderFlags";
/** The ECS/rendering boundary: pack persistent arrays before culling; render passes never query ECS. */
export class RenderExtractor {
  private readonly lightScratch = new Float32Array(16);
  extract(
    world: World,
    out: RenderWorld,
    skeletons?: SkeletonRegistry,
    morphs?: MorphStatePool,
  ): number {
    this.extractLights(world, out);
    this.extractMorphWeights(out, morphs);
    this.extractJointMatrices(world, out, skeletons);
    // Compact live renderables while detecting changes that invalidate the static BVH.
    const previousCount = out.count;
    let staticChanged = false;
    out.count = 0;
    const t = world.transforms,
      b = world.bounds,
      m = world.meshes;
    for (let e = 0; e < world.nextEntity; e++) {
      if (!world.alive[e] || !t.has[e] || !b.has[e] || !m.has[e]) continue;
      if (out.count === out.capacity)
        throw new Error("RenderWorld capacity exceeded");
      const i = out.count++,
        offset = e * 16,
        destination = i * 16;
      const staticAffected =
        ((out.flags[i]! | m.flags[e]!) & RenderFlags.STATIC) !== 0;
      if (
        staticAffected &&
        (i >= previousCount ||
          out.entityId[i] !== e ||
          out.entityGeneration[i] !== world.generation[e] ||
          out.flags[i] !== m.flags[e])
      )
        staticChanged = true;
      out.entityId[i] = e;
      out.entityGeneration[i] = world.generation[e]!;
      out.meshId[i] = m.meshId[e]!;
      out.lodGroup[i] = m.lodGroup[e]!;
      out.materialId[i] = m.materialId[e]!;
      out.flags[i] = m.flags[e]!;
      out.transformIndex[i] = out.boundsIndex[i] = i;
      out.skinInstanceId[i] = world.skins.has[e]
        ? world.skins.instanceId[e]!
        : -1;
      const skeleton = skeletons?.instances[out.skinInstanceId[i]!];
      out.jointOffset[i] = skeleton?.jointOffset ?? 0;
      out.jointCounts[i] = skeleton?.jointCount ?? 0;
      out.morphStateId[i] = world.morphs.has[e] ? world.morphs.stateId[e]! : -1;
      const morph = morphs?.states[out.morphStateId[i]!];
      out.morphOffset[i] = morph?.weightOffset ?? 0;
      out.morphCounts[i] = morph?.targetCount ?? 0;
      if (morph && !out.morphActive[out.morphStateId[i]!]) {
        out.morphActive[out.morphStateId[i]!] = 1;
        out.activeMorphStates++;
        out.morphTargets += morph.targetCount;
        let nonzero = 0;
        for (let target = 0; target < morph.targetCount; target++)
          if (morph.weights[target] !== 0) nonzero++;
        out.morphNonzeroCounts[out.morphStateId[i]!] = nonzero;
        out.activeMorphTargets += nonzero;
      }
      out.morphDense[i] =
        morph &&
        out.morphNonzeroCounts[out.morphStateId[i]!] === morph.targetCount
          ? 1
          : 0;
      for (let k = 0; k < 16; k++)
        out.matrices[destination + k] = t.worldMatrices[offset + k]!;
      const x = b.centerX[e]!,
        y = b.centerY[e]!,
        z = b.centerZ[e]!,
        wm = t.worldMatrices;
      for (let axis = 0; axis < 3; axis++)
        out.sphere[i * 4 + axis] =
          wm[offset + axis]! * x +
          wm[offset + 4 + axis]! * y +
          wm[offset + 8 + axis]! * z +
          wm[offset + 12 + axis]!;
      // Frobenius norm bounds the maximum singular value, including hierarchical shear.
      let normSquared = 0;
      for (let c = 0; c < 3; c++)
        for (let r = 0; r < 3; r++) normSquared += wm[offset + c * 4 + r]! ** 2;
      out.sphere[i * 4 + 3] = b.radius[e]! * Math.sqrt(normSquared);
      for (let r = 0; r < 3; r++) {
        let minimum = wm[offset + 12 + r]!,
          maximum = minimum;
        for (let c = 0; c < 3; c++) {
          const a = wm[offset + c * 4 + r]! * b.min[e * 3 + c]!,
            d = wm[offset + c * 4 + r]! * b.max[e * 3 + c]!;
          minimum += Math.min(a, d);
          maximum += Math.max(a, d);
        }
        if (
          staticAffected &&
          (out.boundsMin[i * 3 + r] !== Math.fround(minimum) ||
            out.boundsMax[i * 3 + r] !== Math.fround(maximum))
        )
          staticChanged = true;
        out.boundsMin[i * 3 + r] = minimum;
        out.boundsMax[i * 3 + r] = maximum;
      }
    }
    if (out.count !== previousCount) staticChanged = true;
    if (staticChanged) out.staticRevision++;
    return out.count;
  }
  /** Transform ECS lights into the packed world-space records used by lighting/shadows. */
  private extractLights(world: World, out: RenderWorld): void {
    out.lightCount = 0;
    const lights = world.lights,
      matrices = world.transforms.worldMatrices;
    for (let e = 0; e < world.nextEntity; e++)
      if (world.alive[e] && world.transforms.has[e] && lights.has[e]) {
        if (out.lightCount === out.lightCapacity)
          throw new Error("Shared light capacity exceeded");
        const id = out.lightCount++,
          o = e * 16,
          p = e * 3,
          d = this.lightScratch;
        for (let axis = 0; axis < 3; axis++) {
          d[axis] = matrices[o + 12 + axis]!;
          d[4 + axis] = lights.color[p + axis]!;
          d[8 + axis] =
            matrices[o + axis]! * lights.direction[p]! +
            matrices[o + 4 + axis]! * lights.direction[p + 1]! +
            matrices[o + 8 + axis]! * lights.direction[p + 2]!;
        }
        const length = Math.hypot(d[8]!, d[9]!, d[10]!);
        if (length === 0) throw new Error("Singular light transform");
        for (let axis = 8; axis < 11; axis++) d[axis]! /= length;
        d[3] = lights.range[e]!;
        d[7] = lights.intensity[e]!;
        d[11] = lights.type[e]!;
        d[12] = Math.cos(lights.innerCone[e]!);
        d[13] = Math.cos(lights.outerCone[e]!);
        // Preserve renderer-owned shadow metadata until the shadow manager updates it.
        const sameLight = out.lightEntity[id] === e;
        d[14] = sameLight ? out.lightData[id * 16 + 14]! : 0;
        d[15] = sameLight ? out.lightData[id * 16 + 15]! : 0;
        out.lightEntity[id] = e;
        out.lightShadow[id] = lights.castShadow[e]!;
        for (let k = 0; k < 16; k++)
          if (out.lightData[id * 16 + k] !== d[k]) {
            out.lightData[id * 16 + k] = d[k]!;
            out.lightDirty[id] = 1;
          }
      }
  }

  /** Copy dirty weights once; render objects later reference these shared pool offsets. */
  private extractMorphWeights(out: RenderWorld, morphs?: MorphStatePool): void {
    out.activeMorphStates = out.activeMorphTargets = out.morphTargets = 0;
    if (morphs) {
      if (morphs.count > out.morphCapacity)
        throw new Error("Render morph capacity exceeded");
      out.morphWeightCount = morphs.count;
      out.morphActive.fill(0, 0, morphs.states.length);
      for (const state of morphs.states)
        if (state.dirty) {
          for (let w = 0; w < state.targetCount; w++) {
            const dst = state.weightOffset + w;
            if (out.morphWeights[dst] !== state.weights[w]) {
              out.morphWeights[dst] = state.weights[w]!;
              out.morphDirty[dst] = 1;
            }
          }
          state.dirty = false;
        }
    }
  }

  /** Retain independent palettes while coalescing subsequent GPU uploads by dirty joint. */
  private extractJointMatrices(
    world: World,
    out: RenderWorld,
    skeletons?: SkeletonRegistry,
  ): void {
    out.activeSkeletons = out.activeJoints = 0;
    if (skeletons) {
      if (skeletons.jointCount > out.jointCapacity)
        throw new Error("Render joint capacity exceeded");
      out.jointCount = skeletons.jointCount;
      for (const instance of skeletons.instances) {
        if (!world.alive[instance.meshEntity]) continue;
        out.activeSkeletons++;
        out.activeJoints += instance.jointCount;
        for (let j = 0; j < instance.jointCount; j++)
          if (instance.dirtyJoints[j]) {
            const dst = (instance.jointOffset + j) * 16,
              src = j * 16;
            for (let k = 0; k < 16; k++)
              out.jointMatrices[dst + k] = instance.matrices[src + k]!;
            out.jointDirty[instance.jointOffset + j] = 1;
            instance.dirtyJoints[j] = 0;
          }
      }
    }
  }
}
