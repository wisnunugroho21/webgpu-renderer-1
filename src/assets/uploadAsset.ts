import { RuntimeAsset } from "./gltf/RuntimeAsset";
import { UploadedAsset } from "./gltf/instantiate";
import { MeshManager } from "../rendering/MeshManager";
import { MaterialManager } from "../rendering/materials/MaterialManager";
import { MaterialTextures } from "../rendering/materials/MaterialTextures";
/** Cold asset upload shared by cached instantiations. Recheck device ownership after every await.
 * Yield between primitives so large scenes don't starve animation; packing one primitive is synchronous. */
export async function uploadAsset(
  asset: RuntimeAsset,
  meshes: MeshManager,
  materials: MaterialManager,
  textures: MaterialTextures,
  checkDevice: () => void,
): Promise<UploadedAsset> {
  checkDevice();
  const groups = await textures.prepare(asset);
  checkDevice();
  if (materials.count + asset.materials.length + 1 > materials.capacity)
    throw new Error("Material capacity exceeded by asset");
  const materialIds = asset.materials.map((material) =>
    materials.create(material),
  );
  const defaultMaterial = materials.create({
    metallic: 1,
    roughness: 1,
  });
  for (let i = 0; i < groups.length; i++)
    textures.groups[materialIds[i]!] = groups[i]!;
  const meshIds: number[][] = [];
  for (const mesh of asset.meshes) {
    const ids: number[] = [];
    meshIds.push(ids);
    for (const primitive of mesh.primitives) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      checkDevice();
      ids.push(meshes.upload(primitive));
    }
  }
  return { materialIds, defaultMaterial, meshIds };
}
