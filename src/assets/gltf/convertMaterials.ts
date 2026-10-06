import type {
  Clearcoat,
  Transmission,
  Volume,
  IOR,
  Specular,
  EmissiveStrength,
  Transform,
} from "@gltf-transform/extensions";
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
          texCoord:
            info
              .getExtension<Transform>("KHR_texture_transform")
              ?.getTexCoord() ?? info.getTexCoord(),
          offset: info
            .getExtension<Transform>("KHR_texture_transform")
            ?.getOffset(),
          scale: info
            .getExtension<Transform>("KHR_texture_transform")
            ?.getScale(),
          rotation: info
            .getExtension<Transform>("KHR_texture_transform")
            ?.getRotation(),
          magFilter: info.getMagFilter(),
          minFilter: info.getMinFilter(),
          wrapS: info.getWrapS(),
          wrapT: info.getWrapT(),
        }
      : null;
  return materials.map((material) => {
    // Preserve PBR values and sampler metadata for later material publication.

    const bindings: Record<string, RuntimeTextureSlot> = {},
      coat = material.getExtension<Clearcoat>("KHR_materials_clearcoat"),
      spec = material.getExtension<Specular>("KHR_materials_specular"),
      transmission = material.getExtension<Transmission>(
        "KHR_materials_transmission",
      ),
      volume = material.getExtension<Volume>("KHR_materials_volume");
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
    for (const [name, texture, info] of [
      [
        "clearcoat",
        coat?.getClearcoatTexture(),
        coat?.getClearcoatTextureInfo(),
      ],
      [
        "clearcoatRoughness",
        coat?.getClearcoatRoughnessTexture(),
        coat?.getClearcoatRoughnessTextureInfo(),
      ],
      [
        "clearcoatNormal",
        coat?.getClearcoatNormalTexture(),
        coat?.getClearcoatNormalTextureInfo(),
      ],
      [
        "transmission",
        transmission?.getTransmissionTexture(),
        transmission?.getTransmissionTextureInfo(),
      ],
      [
        "thickness",
        volume?.getThicknessTexture(),
        volume?.getThicknessTextureInfo(),
      ],
      ["specular", spec?.getSpecularTexture(), spec?.getSpecularTextureInfo()],
      [
        "specularColor",
        spec?.getSpecularColorTexture(),
        spec?.getSpecularColorTextureInfo(),
      ],
    ] as const) {
      const binding = slot(texture ?? null, info ?? null);
      if (binding) bindings[name] = binding;
    }
    return {
      transmission: transmission?.getTransmissionFactor(),
      thickness: volume?.getThicknessFactor(),
      attenuationDistance: volume?.getAttenuationDistance(),
      attenuationColor: volume?.getAttenuationColor(),
      ior: material.getExtension<IOR>("KHR_materials_ior")?.getIOR(),
      specular: spec?.getSpecularFactor(),
      specularColor: spec?.getSpecularColorFactor(),
      clearcoat: coat?.getClearcoatFactor(),
      clearcoatRoughness: coat?.getClearcoatRoughnessFactor(),
      clearcoatNormalScale: coat?.getClearcoatNormalScale(),
      emissiveStrength: material
        .getExtension<EmissiveStrength>("KHR_materials_emissive_strength")
        ?.getEmissiveStrength(),
      unlit: !!material.getExtension("KHR_materials_unlit"),
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
