import { RuntimeAsset } from "./gltf/RuntimeAsset";
import { UploadedAsset } from "./gltf/instantiate";
import { MeshManager } from "../rendering/MeshManager";
import { MaterialManager } from "../rendering/materials/MaterialManager";
import { MaterialTextures } from "../rendering/materials/MaterialTextures";
/** Detach every consumer before calling. Fences are cold lifecycle work, never frame work. */
export async function releaseUploadedAsset(
  asset: UploadedAsset,
  meshes: MeshManager,
  materials: MaterialManager,
  textures: MaterialTextures,
  fence: () => Promise<void>,
): Promise<void> {
  for (const id of asset.materialIds) delete textures.groups[id];
  // A lost/disposed device can reject its fence; its resources still need CPU cleanup.
  await fence().catch(() => {});
  for (const ids of asset.meshIds)
    for (const id of ids) if (meshes.entries[id]) meshes.destroy(id);
  for (const id of [...asset.materialIds, asset.defaultMaterial])
    if (id >= 0) materials.release(id);
  // Clear reclaimed IDs before another asynchronous step: retries must never release
  // a material slot that another asset has since reused.
  asset.meshIds.length = 0;
  asset.materialIds.length = 0;
  asset.defaultMaterial = -1;
  if (asset.textureGroups) {
    await textures.release(asset.textureGroups);
    asset.textureGroups = undefined;
  }
}
/** Publish only after every primitive succeeds. Ownership stays local until commit.
 * Yield between primitives; recheck cancellation/device ownership after every await. */
export async function uploadAsset(
  asset: RuntimeAsset,
  meshes: MeshManager,
  materials: MaterialManager,
  textures: MaterialTextures,
  checkDevice: () => void,
  fence: () => Promise<void> = () => meshes.fence(),
): Promise<UploadedAsset> {
  const uploaded: UploadedAsset = {
    materialIds: [],
    defaultMaterial: -1,
    meshIds: [],
  };
  try {
    checkDevice();
    if (materials.available < asset.materials.length + 1)
      throw new Error("Material capacity exceeded by asset");
    uploaded.textureGroups = await textures.prepare(asset);
    checkDevice();
    // Another upload may allocate materials while textures are being prepared.
    if (materials.available < asset.materials.length + 1)
      throw new Error("Material capacity exceeded by asset");
    for (const material of asset.materials)
      uploaded.materialIds.push(materials.create(material));
    uploaded.defaultMaterial = materials.create({ metallic: 1, roughness: 1 });
    for (const mesh of asset.meshes) {
      const ids: number[] = [];
      uploaded.meshIds.push(ids);
      for (const primitive of mesh.primitives) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        checkDevice();
        ids.push(meshes.upload(primitive));
      }
    }
    checkDevice();
    for (let i = 0; i < uploaded.textureGroups.length; i++)
      textures.groups[uploaded.materialIds[i]!] = uploaded.textureGroups[i]!;
    return uploaded;
  } catch (error) {
    await releaseUploadedAsset(uploaded, meshes, materials, textures, fence);
    throw error;
  }
}
