import type { Material } from "./Material";
/** Stable role indices shared by the packed UV transforms and texture bindings. */
export const textureRoles = [
  "baseColor",
  "metallicRoughness",
  "normal",
  "occlusion",
  "emissive",
  "clearcoat",
  "clearcoatRoughness",
  "clearcoatNormal",
  "specular",
  "specularColor",
  "transmission",
  "thickness",
] as const;
/** Color maps require sRGB decoding; factors, normals and channel masks are linear. */
export function isColorTexture(role: string): boolean {
  return (
    role === "baseColor" || role === "emissive" || role === "specularColor"
  );
}
/** Validate and pack affine UV rows on the cold material publication path. */
export function packTextureLayout(
  slots: Material["textures"] = {},
): Float32Array {
  const result = new Float32Array(103);
  result.set([
    slots.emissive?.texCoord ?? 0,
    slots.normal ? 1 : 0,
    slots.baseColor?.texCoord ?? 0,
    slots.metallicRoughness?.texCoord ?? 0,
    slots.normal?.texCoord ?? 0,
    slots.occlusion?.texCoord ?? 0,
  ]);
  for (let i = 0; i < textureRoles.length; i++) {
    const slot = slots[textureRoles[i]!],
      uv = slot?.texCoord ?? 0,
      offset = slot?.offset ?? [0, 0],
      scale = slot?.scale ?? [1, 1],
      rotation = slot?.rotation ?? 0;
    if (uv !== 0 && uv !== 1)
      throw new Error("Only TEXCOORD_0/1 are supported");
    if (
      offset.length !== 2 ||
      scale.length !== 2 ||
      [...Array.from(offset), ...Array.from(scale), rotation].some(
        (v) =>
          /** Reject affine coefficients that cannot be represented in finite GPU storage. */ !Number.isFinite(
            Math.fround(v),
          ),
      )
    )
      throw new Error("Invalid texture transform");
    const c = Math.cos(rotation),
      s = Math.sin(rotation),
      o = 6 + i * 8;
    result.set(
      [
        c * scale[0]!,
        -s * scale[1]!,
        offset[0]!,
        uv,
        s * scale[0]!,
        c * scale[1]!,
        offset[1]!,
        Number(
          rotation !== 0 ||
            offset[0] !== 0 ||
            offset[1] !== 0 ||
            scale[0] !== 1 ||
            scale[1] !== 1,
        ),
      ],
      o,
    );
    if (slot && i >= 5) result[102]! |= 1 << (i - 5);
  }
  return result;
}
