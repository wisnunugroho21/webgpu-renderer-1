import { Material } from "../../rendering/materials/Material";
export interface RuntimePrimitive {
  attributes: Record<string, Float32Array>;
  indices: Uint32Array;
  mode: number;
  material: number;
  targets: Record<string, Float32Array>[];
}
export interface RuntimeTextureSlot {
  texture: number;
  texCoord: number;
  magFilter: number | null;
  minFilter: number | null;
  wrapS: number;
  wrapT: number;
}
export interface RuntimeMaterial extends Material {
  textures: Record<string, RuntimeTextureSlot>;
  emissive: Float32Array;
  normalScale: number;
  occlusionStrength: number;
}
export interface RuntimeAsset {
  meshes: {
    name: string;
    primitives: RuntimePrimitive[];
    weights: Float32Array;
  }[];
  nodes: {
    name: string;
    children: Uint32Array;
    mesh: number;
    skin: number;
    camera: number;
    position: Float32Array;
    rotation: Float32Array;
    scale: Float32Array;
    matrix: Float32Array;
    weights: Float32Array;
  }[];
  materials: RuntimeMaterial[];
  textures: { name: string; mimeType: string; image: Uint8Array }[];
  skins: {
    joints: Uint32Array;
    inverseBindMatrices: Float32Array;
    skeleton: number;
  }[];
  animations: {
    name: string;
    channels: {
      node: number;
      path: string;
      interpolation: string;
      input: Float32Array;
      output: Float32Array;
      elementSize: number;
    }[];
  }[];
  cameras: {
    type: string;
    near: number;
    far: number;
    aspect: number | null;
    fovY: number;
    xMag: number;
    yMag: number;
  }[];
  scenes: Uint32Array[];
  defaultScene: number;
}
