import { withFlatNormals } from "./geometry/preparePrimitive";
import { prepareIndices } from "./geometry/PrimitiveTopology";
import { VERTEX_WORDS, VertexWord } from "./geometry/VertexLayout";
import { MorphDeltaBuffers } from "./MorphDeltaBuffers";
import { MorphTargetData } from "../animation/MorphTargetData";
import { SkinVertexData } from "../animation/skinning/SkinVertexData";
import { Resources } from "../gpu/Resources";
import { RuntimePrimitive } from "../assets/gltf/RuntimeAsset";
import { MeshClusters } from "./geometry/MeshClusters";
export interface Mesh {
  clusters?: MeshClusters;
  vertex: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
  topology: 0 | 1 | 2;
  skin?: SkinVertexData;
  morph?: MorphTargetData;
  morphOffset?: number;
  deformationVertexCount?: number;
  bounds?: { min: Float32Array; max: Float32Array };
}
/** Shared asset meshes; entities refer to numeric mesh IDs and never own buffers. */
export class MeshManager {
  readonly entries: Mesh[] = [];
  private readonly recovery = new Map<
    number,
    { vertices: Float32Array; indices: Uint32Array }
  >();
  get recoveryBytes(): number {
    let bytes = 0;
    for (const data of this.recovery.values())
      bytes += data.vertices.byteLength + data.indices.byteLength;
    return bytes;
  }
  assertRecoverable(): void {
    for (let id = 1; id < this.entries.length; id++)
      if (this.entries[id] && !this.recovery.has(id))
        throw new Error(
          `Mesh ${id} has no CPU recovery data; register it with packed recovery arrays`,
        );
  }
  rebuildInto(next: MeshManager): void {
    this.assertRecoverable();
    for (let id = 1; id < this.entries.length; id++) {
      const mesh = this.entries[id];
      if (!mesh) continue;
      const data = this.recovery.get(id)!;
      const vertex = next.resources.buffers.create({
        label: "Restored vertices",
        size: data.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      const index = next.resources.buffers.create({
        label: "Restored indices",
        size: data.indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      next.queue.writeBuffer(vertex, 0, data.vertices);
      next.queue.writeBuffer(index, 0, data.indices);
      next.entries.length = id;
      next.register({
        ...mesh,
        vertex,
        index,
        morphOffset:
          mesh.morph || mesh.skin?.secondary
            ? next.morphDeltas?.append(
                mesh.morph,
                mesh.skin?.secondary,
                mesh.deformationVertexCount,
              )
            : undefined,
      });
      next.recovery.set(id, data);
    }
    next.entries.length = this.entries.length;
  }
  clearRecovery(): void {
    this.recovery.clear();
  }
  constructor(
    private readonly resources: Resources,
    private readonly queue: GPUQueue,
    private readonly morphDeltas?: MorphDeltaBuffers,
  ) {}
  fence(): Promise<void> {
    return this.queue.onSubmittedWorkDone();
  }
  register(
    mesh: Mesh,
    recovery?: { vertices: Float32Array; indices: Uint32Array },
  ): number {
    if (recovery)
      this.recovery.set(this.entries.length, {
        vertices: recovery.vertices.slice(),
        indices: recovery.indices.slice(),
      });
    this.entries.push(mesh);
    return this.entries.length - 1;
  }
  get(id: number): Mesh {
    const mesh = this.entries[id];
    if (!mesh) throw new Error(`Unknown mesh ${id}`);
    return mesh;
  }
  destroy(id: number): void {
    const mesh = this.get(id);
    this.resources.buffers.destroy(mesh.vertex);
    this.resources.buffers.destroy(mesh.index);
    if (mesh.morphOffset !== undefined)
      this.morphDeltas?.release(mesh.morphOffset);
    delete this.entries[id];
    this.recovery.delete(id);
  }
  upload(primitive: RuntimePrimitive): number {
    const positions = primitive.attributes.POSITION!;
    if (!positions || positions.length % 3)
      throw new Error("Invalid mesh positions");
    const count = positions.length / 3,
      colors = primitive.attributes.COLOR_0,
      colorStride = colors ? colors.length / count : 0;
    if (!primitive.attributes.NORMAL && primitive.mode >= 4)
      return this.upload(withFlatNormals(primitive));
    const morph = primitive.targets.length
      ? new MorphTargetData(primitive.targets, count)
      : undefined;
    const skin = SkinVertexData.fromPrimitive(primitive);
    if (skin?.secondary && !this.morphDeltas)
      throw new Error("Eight-weight skinning requires a deformation arena");
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
    const morphOffset =
      morph || skin?.secondary
        ? this.morphDeltas?.append(morph, skin?.secondary, count)
        : undefined;
    let vertex: GPUBuffer | undefined, index: GPUBuffer | undefined;
    try {
      vertex = this.resources.buffers.create({
        label: "Asset vertices",
        size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      index = this.resources.buffers.create({
        label: "Asset indices",
        size: indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      this.queue.writeBuffer(vertex, 0, vertices);
      this.queue.writeBuffer(index, 0, indices);
      const id = this.register({
        clusters,
        vertex,
        index,
        indexCount: indices.length,
        topology,
        skin,
        morph,
        morphOffset,
        deformationVertexCount: morph || skin?.secondary ? count : undefined,
        bounds: { min, max },
      });
      this.recovery.set(id, { vertices, indices });
      return id;
    } catch (error) {
      if (vertex) this.resources.buffers.destroy(vertex);
      if (index) this.resources.buffers.destroy(index);
      if (morphOffset !== undefined) this.morphDeltas?.release(morphOffset);
      throw error;
    }
  }
}
