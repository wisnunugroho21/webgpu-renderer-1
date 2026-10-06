export type AlphaMode = "OPAQUE" | "MASK" | "BLEND";
export interface MaterialTextureSlot {
  texCoord: number;
  offset?: ArrayLike<number>;
  scale?: ArrayLike<number>;
  rotation?: number;
}
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
  /** Dielectric index of refraction (default 1.5); zero selects glTF infinite-IOR compatibility. */
  ior?: number;
  /** Dielectric reflection weight in [0,1]; metals retain their base-color reflectance. */
  specular?: number;
  /** Linear dielectric reflection tint; components above one are allowed and Fresnel is clamped. */
  specularColor?: ArrayLike<number>;
  /** Independent top GGX layer weight in [0,1], disabled by default. */
  clearcoat?: number;
  clearcoatRoughness?: number;
  clearcoatNormalScale?: number;
  emissiveStrength?: number;
  /** Built-in unlit ignores lighting, AO, normal maps and emission, preserving base/vertex color and alpha. */
  unlit?: boolean;
  /** Fraction of dielectric diffuse energy transmitted through the surface. */
  transmission?: number;
  /** Mesh-local baked thickness; zero is a thin surface. */
  thickness?: number;
  /** World-space absorption distance; omitted/Infinity disables absorption. */
  attenuationDistance?: number;
  /** Linear color remaining after one attenuation distance. */
  attenuationColor?: ArrayLike<number>;
  textures?: Record<string, MaterialTextureSlot>;
}
