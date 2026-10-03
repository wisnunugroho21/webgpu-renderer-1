import { MeshManager } from "../MeshManager";
export interface LODGroup {
  readonly meshes: Uint32Array;
  readonly thresholds: Float32Array;
  readonly hysteresis: number;
}
/** Authored LOD assets share material/deformation layout and fit the base envelopes. */
export class LODGroups {
  readonly entries: LODGroup[] = [];
  register(
    meshIds: ArrayLike<number>,
    thresholds: ArrayLike<number>,
    meshes: MeshManager,
    hysteresis = 0.15,
  ): number {
    if (
      meshIds.length < 1 ||
      meshIds.length > 8 ||
      thresholds.length !== meshIds.length ||
      !Number.isFinite(hysteresis) ||
      hysteresis < 0 ||
      hysteresis >= 1
    )
      throw new Error("Invalid LOD group");
    for (let i = 0; i < thresholds.length; i++)
      if (
        !Number.isFinite(thresholds[i]) ||
        thresholds[i]! <= 0 ||
        (i > 0 && thresholds[i]! >= thresholds[i - 1]!)
      )
        throw new Error("LOD thresholds must decrease");
    this.validateMeshes(meshIds, meshes);
    return (
      this.entries.push({
        meshes: Uint32Array.from(meshIds),
        thresholds: Float32Array.from(thresholds),
        hysteresis,
      }) - 1
    );
  }
  replace(
    groupId: number,
    level: number,
    meshId: number,
    meshes: MeshManager,
  ): void {
    const group = this.entries[groupId];
    if (
      !group ||
      !Number.isInteger(level) ||
      level < 1 ||
      level >= group.meshes.length
    )
      throw new Error("Invalid streamed LOD slot");
    const ids = group.meshes.slice();
    ids[level] = meshId;
    this.validateMeshes(ids, meshes);
    group.meshes[level] = meshId;
  }
  private validateMeshes(
    meshIds: ArrayLike<number>,
    meshes: MeshManager,
  ): void {
    const base = meshes.get(meshIds[0]!);
    for (let i = 0; i < meshIds.length; i++) {
      if (!Number.isInteger(meshIds[i]) || meshIds[i]! < 0)
        throw new Error("Invalid LOD mesh ID");
      const mesh = meshes.get(meshIds[i]!);
      if (
        mesh.topology !== base.topology ||
        !!mesh.skin !== !!base.skin ||
        mesh.morph?.targetCount !== base.morph?.targetCount ||
        !mesh.bounds ||
        !base.bounds
      )
        throw new Error("Incompatible LOD mesh");
      for (let axis = 0; axis < 3; axis++)
        if (
          mesh.bounds.min[axis]! < base.bounds.min[axis]! - 1e-6 ||
          mesh.bounds.max[axis]! > base.bounds.max[axis]! + 1e-6
        )
          throw new Error("LOD exceeds base bounds");
      if (mesh.morph && base.morph)
        for (let j = 0; j < mesh.morph.positionMin.length; j++)
          if (
            mesh.morph.positionMin[j]! < base.morph.positionMin[j]! - 1e-6 ||
            mesh.morph.positionMax[j]! > base.morph.positionMax[j]! + 1e-6
          )
            throw new Error("LOD morph exceeds base envelope");
    }
  }
}
