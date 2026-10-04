import type { Material, Texture, TextureInfo } from "@gltf-transform/core";
import type { RuntimeAsset, RuntimeTextureSlot } from "./RuntimeAsset";

/** Convert PBR factors and texture slots in the original binding order. */
export function convertMaterials(
  materials: Material[],
  textures: Texture[],
): RuntimeAsset["materials"] {
  /** Preserve texture index, UV set and sampler metadata without GPU resources. */
  const slot = (
    texture: Texture | null,
    info: TextureInfo | null,
  ): RuntimeTextureSlot | null =>
    texture && info
      ? {
          texture: textures.indexOf(texture),
          texCoord: info.getTexCoord(),
          magFilter: info.getMagFilter(),
          minFilter: info.getMinFilter(),
          wrapS: info.getWrapS(),
          wrapT: info.getWrapT(),
        }
      : null;
  return materials.map((material) => {
    // Preserve PBR values and sampler metadata for later material publication.

    const bindings: Record<string, RuntimeTextureSlot> = {};
    for (const [name, texture, info] of [
      [
        "baseColor",
        material.getBaseColorTexture(),
        material.getBaseColorTextureInfo(),
      ],
      ["normal", material.getNormalTexture(), material.getNormalTextureInfo()],
      [
        "metallicRoughness",
        material.getMetallicRoughnessTexture(),
        material.getMetallicRoughnessTextureInfo(),
      ],
      [
        "occlusion",
        material.getOcclusionTexture(),
        material.getOcclusionTextureInfo(),
      ],
      [
        "emissive",
        material.getEmissiveTexture(),
        material.getEmissiveTextureInfo(),
      ],
    ] as const) {
      const binding = slot(texture, info);
      if (binding) bindings[name] = binding;
    }
    return {
      baseColor: material.getBaseColorFactor(),
      metallic: material.getMetallicFactor(),
      roughness: material.getRoughnessFactor(),
      alphaMode: material.getAlphaMode(),
      alphaCutoff: material.getAlphaCutoff(),
      doubleSided: material.getDoubleSided(),
      textures: bindings,
      emissive: new Float32Array(material.getEmissiveFactor()),
      normalScale: material.getNormalScale(),
      occlusionStrength: material.getOcclusionStrength(),
    };
  });
}

/** Copy encoded image bytes so decoded assets own their texture payloads. */
export function convertTextures(textures: Texture[]): RuntimeAsset["textures"] {
  return textures.map(
    (texture) => /** Do not retain a view into parser-owned image bytes. */ ({
      name: texture.getName(),
      mimeType: texture.getMimeType(),
      image: (texture.getImage() ?? new Uint8Array(0)).slice(),
    }),
  );
}
