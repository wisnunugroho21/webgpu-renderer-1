export type AlphaMode = "OPAQUE" | "MASK" | "BLEND";
export interface Material {
  baseColor?: readonly [number, number, number, number];
  metallic?: number;
  roughness?: number;
  alphaMode?: AlphaMode;
  alphaCutoff?: number;
  doubleSided?: boolean;
}
