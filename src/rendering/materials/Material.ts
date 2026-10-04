export type AlphaMode = "OPAQUE" | "MASK" | "BLEND";
export interface Material {
  /** Registered custom family ID; omitted/zero selects built-in PBR. */
  shaderId?: number;
  /** Up to 16 finite f32 parameters; omitted entries are zero. */
  shaderParameters?: ArrayLike<number>;
  baseColor?: readonly [number, number, number, number];
  metallic?: number;
  roughness?: number;
  alphaMode?: AlphaMode;
  alphaCutoff?: number;
  doubleSided?: boolean;
  emissive?: ArrayLike<number>;
  normalScale?: number;
  occlusionStrength?: number;
  textures?: Record<string, { texCoord: number }>;
}
