import type { Material } from "./Material";
import { packTextureLayout } from "./MaterialTextureLayout";

/** Validate every factor/map before any shared material row or shader parameter mutation. */
export function prepareMaterialFactors(material: Material) {
  const baseColor = material.baseColor ?? [1, 1, 1, 1],
    metallic = material.metallic ?? 0,
    roughness = material.roughness ?? 1,
    cutoff = material.alphaCutoff ?? 0.5;
  if (
    baseColor.length !== 4 ||
    [...baseColor, metallic, roughness, cutoff].some(
      (v) =>
        /** Evaluates the !Number.isFinite(v) || v < 0 condition. */ !Number.isFinite(
          v,
        ) || v < 0,
    ) ||
    metallic > 1 ||
    roughness > 1 ||
    baseColor[3] > 1 ||
    cutoff > 1
  )
    throw new Error("Invalid material values");
  const mode = material.alphaMode ?? "OPAQUE",
    alpha =
      mode === "OPAQUE" ? 0 : mode === "MASK" ? 1 : mode === "BLEND" ? 2 : -1;
  if (alpha < 0) throw new Error("Invalid alpha mode");
  const emissive = material.emissive ?? [0, 0, 0],
    normalScale = material.normalScale ?? 1,
    occlusion = material.occlusionStrength ?? 1;
  if (
    [emissive[0], emissive[1], emissive[2], normalScale, occlusion].some(
      (v) =>
        /** Evaluates the v === undefined || !Number.isFinite(v) || v < 0 condition. */ v ===
          undefined ||
        !Number.isFinite(v) ||
        v < 0,
    ) ||
    occlusion > 1
  )
    throw new Error("Invalid PBR properties");
  const layout = packTextureLayout(material.textures),
    ior = material.ior ?? 1.5,
    specular = material.specular ?? 1,
    specularColor = material.specularColor ?? [1, 1, 1],
    clearcoat = material.clearcoat ?? 0,
    coatRoughness = material.clearcoatRoughness ?? 0,
    coatNormalScale = material.clearcoatNormalScale ?? 1,
    strength = material.emissiveStrength ?? 1;
  if (
    specularColor.length !== 3 ||
    [
      ior,
      specular,
      ...Array.from(specularColor),
      clearcoat,
      coatRoughness,
      coatNormalScale,
      strength,
    ].some(
      (v) =>
        /** Reject invalid or unrepresentable authored factors before any record mutation. */ !Number.isFinite(
          Math.fround(v),
        ) || v < 0,
    ) ||
    (ior !== 0 && ior < 1) ||
    specular > 1 ||
    clearcoat > 1 ||
    coatRoughness > 1
  )
    throw new Error("Invalid authored PBR properties");
  const transmission = material.transmission ?? 0,
    thickness = material.thickness ?? 0,
    attenuationDistance = material.attenuationDistance ?? Infinity,
    attenuationColor = material.attenuationColor ?? [1, 1, 1];
  if (
    !Number.isFinite(Math.fround(transmission)) ||
    transmission < 0 ||
    transmission > 1 ||
    !Number.isFinite(Math.fround(thickness)) ||
    thickness < 0 ||
    attenuationColor.length !== 3 ||
    Array.from(attenuationColor).some((v) => {
      // Absorption must never amplify transmitted radiance or publish nonfinite factors.
      return !Number.isFinite(Math.fround(v)) || v < 0 || v > 1;
    }) ||
    (attenuationDistance !== Infinity &&
      (!Number.isFinite(Math.fround(attenuationDistance)) ||
        Math.fround(attenuationDistance) <= 0)) ||
    (material.unlit && transmission > 0)
  )
    throw new Error("Invalid transmission/volume properties");
  return {
    baseColor,
    metallic,
    roughness,
    cutoff,
    alpha,
    emissive,
    normalScale,
    occlusion,
    layout,
    ior,
    specular,
    specularColor,
    clearcoat,
    coatRoughness,
    coatNormalScale,
    strength,
    transmission,
    thickness,
    attenuationDistance,
    attenuationColor,
  };
}

/** Pack the validated scalar/UV state into the established 136-word shader ABI on the cold path. */
export function writeMaterialFactors(
  data: Float32Array,
  offset: number,
  material: Material,
  prepared: ReturnType<typeof prepareMaterialFactors>,
): void {
  const {
    baseColor,
    metallic,
    roughness,
    cutoff,
    alpha,
    emissive,
    normalScale,
    occlusion,
    layout,
    ior,
    specular,
    specularColor,
    clearcoat,
    coatRoughness,
    coatNormalScale,
    strength,
    transmission,
    thickness,
    attenuationDistance,
    attenuationColor,
  } = prepared;
  /** Read the validated UV index for legacy metadata fields. */
  const uv = (role: string) => material.textures?.[role]?.texCoord ?? 0;
  data.set(baseColor, offset);
  data.set([metallic, roughness, alpha, cutoff], offset + 4);
  data.set([emissive[0]!, emissive[1]!, emissive[2]!, normalScale], offset + 8);
  data.set(
    [
      occlusion,
      uv("emissive"),
      material.textures?.normal ? 1 : 0,
      material.doubleSided && thickness === 0 ? 1 : 0,
    ],
    offset + 12,
  );
  data.set(
    [uv("baseColor"), uv("metallicRoughness"), uv("normal"), uv("occlusion")],
    offset + 16,
  );
  data.set([ior, specular, strength, material.unlit ? 1 : 0], offset + 20);
  data.set(
    [specularColor[0]!, specularColor[1]!, specularColor[2]!, clearcoat],
    offset + 24,
  );
  data.set([coatRoughness, coatNormalScale, 0, layout[102]!], offset + 28);
  data.set(layout.subarray(6, 102), offset + 40);
  data.set([transmission, thickness, 0, 0], offset + 32);
  data.set(
    [
      attenuationColor[0]!,
      attenuationColor[1]!,
      attenuationColor[2]!,
      attenuationDistance === Infinity ? 0 : attenuationDistance,
    ],
    offset + 36,
  );
}
