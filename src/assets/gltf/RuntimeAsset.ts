import type { PreparedMesh } from "../../rendering/geometry/prepareMesh";
import type { Material } from "../../rendering/materials/Material";
/** Decoded primitive attributes and morph targets; prepared data is optional and GPU-free. */
export interface RuntimePrimitive {
  /** Optional worker-prepared canonical data; no GPU handles. */
  prepared?: PreparedMesh;
  attributes: Record<string, Float32Array>;
  indices: Uint32Array;
  mode: number;
  material: number;
  targets: Record<string, Float32Array>[];
}
/** Texture-table index and sampler metadata used during material publication. */
export interface RuntimeTextureSlot {
  texture: number;
  texCoord: number;
  magFilter: number | null;
  minFilter: number | null;
  wrapS: number;
  wrapT: number;
}
/** Decoded PBR metadata; texture references point into RuntimeAsset.textures. */
export interface RuntimeMaterial extends Material {
  textures: Record<string, RuntimeTextureSlot>;
  emissive: Float32Array;
  normalScale: number;
  occlusionStrength: number;
}
/** Shared primitive geometry and default morph weights. */
export interface RuntimeMesh {
  name: string;
  primitives: RuntimePrimitive[];
  weights: Float32Array;
}

/** Scene references use table indices; absent mesh, skin and camera references use -1. */
export interface RuntimeNode {
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
}

/** Owned encoded image bytes, ready for asynchronous texture decoding. */
export interface RuntimeTexture {
  name: string;
  mimeType: string;
  image: Uint8Array;
}

/** Joint indices and inverse binds in matching order; absent skeleton uses -1. */
export interface RuntimeSkin {
  joints: Uint32Array;
  inverseBindMatrices: Float32Array;
  skeleton: number;
}

/** Owned keyframe arrays with target-node index and interpolation metadata. */
export interface RuntimeAnimationChannel {
  node: number;
  path: string;
  interpolation: string;
  input: Float32Array;
  output: Float32Array;
  elementSize: number;
}

/** Named ordered channels retained for clip preparation. */
export interface RuntimeAnimation {
  name: string;
  channels: RuntimeAnimationChannel[];
}

/** Projection metadata without browser, ECS or GPU ownership. */
export interface RuntimeCamera {
  type: string;
  near: number;
  far: number;
  aspect: number | null;
  fovY: number;
  xMag: number;
  yMag: number;
}

/** Engine-owned decoded data: serializable metadata plus transferable typed arrays.
 * GPU uploads and scene instantiation are separate steps; this object owns no GPU resources. */
export interface RuntimeAsset {
  meshes: RuntimeMesh[];
  nodes: RuntimeNode[];
  materials: RuntimeMaterial[];
  textures: RuntimeTexture[];
  skins: RuntimeSkin[];
  animations: RuntimeAnimation[];
  cameras: RuntimeCamera[];
  scenes: Uint32Array[];
  defaultScene: number;
}
