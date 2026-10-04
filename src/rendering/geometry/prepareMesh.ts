import { RuntimePrimitive } from "../../assets/gltf/RuntimeAsset";
import { withFlatNormals } from "./preparePrimitive";
import { prepareIndices } from "./PrimitiveTopology";
import { VERTEX_WORDS, VertexWord } from "./VertexLayout";
import { MorphTargetData } from "../../animation/MorphTargetData";
import { SkinVertexData } from "../../animation/skinning/SkinVertexData";
import { MeshClusters } from "./MeshClusters";
export interface PreparedMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  count: number;
  topology: 0 | 1 | 2;
  skin?: SkinVertexData;
  morph?: MorphTargetData;
  clusters?: MeshClusters;
  bounds: { min: Float32Array; max: Float32Array };
}
/** Pure cold preparation can run in a worker; GPU ownership starts only after it succeeds. */
export function prepareMesh(primitive: RuntimePrimitive): PreparedMesh {
  const positions = primitive.attributes.POSITION!;
  if (!positions || positions.length % 3)
    throw new Error("Invalid mesh positions");
  const count = positions.length / 3,
    colors = primitive.attributes.COLOR_0,
    colorStride = colors ? colors.length / count : 0;
  if (!primitive.attributes.NORMAL && primitive.mode >= 4)
    return prepareMesh(withFlatNormals(primitive));
  const morph = primitive.targets.length
    ? new MorphTargetData(primitive.targets, count)
    : undefined;
  const skin = SkinVertexData.fromPrimitive(primitive);
  const vertices = new Float32Array(count * VERTEX_WORDS);
  // Joint IDs share the interleaved storage but must be written as integer bits.
  const bits = new Uint32Array(vertices.buffer);
  const normals = primitive.attributes.NORMAL ?? new Float32Array(count * 3);
  // Cache ABI offsets once; avoid repeated module/property lookups per vertex.
  const {
    color: colorWord,
    normal: normalWord,
    uv0: uv0Word,
    uv1: uv1Word,
    joints: jointsWord,
    weights: weightsWord,
    tangent: tangentWord,
  } = VertexWord;
  const vertexWords = VERTEX_WORDS;
  for (let i = 0; i < count; i++) {
    const o = i * vertexWords;
    for (let axis = 0; axis < 3; axis++) {
      vertices[o + axis] = positions[i * 3 + axis]!;
      vertices[o + colorWord + axis] = colors
        ? colors[i * colorStride + axis]!
        : 1;
      vertices[o + normalWord + axis] = normals[i * 3 + axis]!;
    }
    vertices[o + colorWord + 3] = colorStride === 4 ? colors![i * 4 + 3]! : 1;
    for (let axis = 0; axis < 2; axis++) {
      vertices[o + uv0Word + axis] =
        primitive.attributes.TEXCOORD_0?.[i * 2 + axis] ?? 0;
      vertices[o + uv1Word + axis] =
        primitive.attributes.TEXCOORD_1?.[i * 2 + axis] ?? 0;
    }
    for (let k = 0; k < 4; k++) {
      bits[o + jointsWord + k] = skin?.primary.joints[i * 4 + k] ?? 0;
      vertices[o + weightsWord + k] =
        skin?.primary.weights[i * 4 + k] ?? (k === 0 ? 1 : 0);
    }
    for (let axis = 0; axis < 4; axis++)
      vertices[o + tangentWord + axis] =
        primitive.attributes.TANGENT?.[i * 4 + axis] ?? 0;
  }
  const { topology, indices } = prepareIndices(primitive, count);
  const min = new Float32Array(3).fill(Infinity),
    max = new Float32Array(3).fill(-Infinity);
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis]!, positions[i]!);
    max[axis] = Math.max(max[axis]!, positions[i]!);
  }
  const clusters =
    topology === 0 && !skin && !morph
      ? new MeshClusters(positions, indices)
      : undefined;
  return {
    vertices,
    indices,
    count,
    topology,
    skin,
    morph,
    clusters,
    bounds: { min, max },
  };
}
/** Structured clone preserves data, not prototypes. Restore the engine-owned validation seam. */
export function restorePreparedMesh(mesh: PreparedMesh): void {
  if (mesh.skin) Object.setPrototypeOf(mesh.skin, SkinVertexData.prototype);
  if (mesh.morph) Object.setPrototypeOf(mesh.morph, MorphTargetData.prototype);
  if (mesh.clusters)
    Object.setPrototypeOf(mesh.clusters, MeshClusters.prototype);
}
