import { World } from "../ecs/World";
import { RenderWorld } from "./RenderWorld";
import { RenderFlags } from "./RenderFlags";
export class RenderExtractor {
  extract(world: World, out: RenderWorld): number {
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
          out.flags[i] !== m.flags[e])
      )
        staticChanged = true;
      out.entityId[i] = e;
      out.meshId[i] = m.meshId[e]!;
      out.materialId[i] = m.materialId[e]!;
      out.flags[i] = m.flags[e]!;
      out.transformIndex[i] = out.boundsIndex[i] = i;
      out.skinInstanceId[i] = world.skins.has[e]
        ? world.skins.instanceId[e]!
        : -1;
      out.morphStateId[i] = world.morphs.has[e] ? world.morphs.stateId[e]! : -1;
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
}
