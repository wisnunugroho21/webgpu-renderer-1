import { MorphDeltaBuffers } from "./MorphDeltaBuffers";
import { MorphTargetData } from "../animation/MorphTargetData";
import { SkinVertexData } from "../animation/skinning/SkinVertexData";
import { Resources } from "../gpu/Resources";
import { RuntimePrimitive } from "../assets/gltf/RuntimeAsset";
export interface Mesh {
  vertex: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
  topology: 0 | 1 | 2;
  skin?: SkinVertexData;
  morph?: MorphTargetData;
  morphOffset?: number;
  bounds?: { min: Float32Array; max: Float32Array };
}
/** Shared asset meshes; entities refer to numeric mesh IDs and never own buffers. */
export class MeshManager {
  readonly entries: Mesh[] = [];
  constructor(
    private readonly resources: Resources,
    private readonly queue: GPUQueue,
    private readonly morphDeltas?: MorphDeltaBuffers,
  ) {}
  register(mesh: Mesh): number {
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
    delete this.entries[id];
  }
  upload(primitive: RuntimePrimitive): number {
    const positions = primitive.attributes.POSITION!;
    if (!positions || positions.length % 3)
      throw new Error("Invalid mesh positions");
    const count = positions.length / 3,
      vertices = new Float32Array(count * 26),
      colors = primitive.attributes.COLOR_0,
      colorStride = colors ? colors.length / count : 0;
    if (!primitive.attributes.NORMAL && primitive.mode >= 4) {
      // glTF requires flat normals when NORMAL is absent. Split triangle vertices
      // once at upload, preserving every attribute and morph target correspondence.
      const src = primitive.indices,
        triangles: number[] = [];
      if (primitive.mode === 4) {
        if (src.length % 3) throw new Error("Invalid primitive index count");
        for (const index of src) triangles.push(index);
      } else if (primitive.mode === 5) {
        for (let i = 2; i < src.length; i++)
          triangles.push(
            src[i - (i % 2 ? 1 : 2)]!,
            src[i - (i % 2 ? 2 : 1)]!,
            src[i]!,
          );
      } else if (primitive.mode === 6) {
        for (let i = 2; i < src.length; i++)
          triangles.push(src[0]!, src[i - 1]!, src[i]!);
      } else throw new Error(`Unsupported primitive mode ${primitive.mode}`);
      for (const index of triangles)
        if (index >= count) throw new Error("Primitive index out of range");
      const expand = (attributes: Record<string, Float32Array>) =>
        Object.fromEntries(
          Object.entries(attributes).map(([name, data]) => {
            const stride = data.length / count;
            if (!Number.isInteger(stride))
              throw new Error("Invalid mesh attribute size");
            const expanded = new Float32Array(triangles.length * stride);
            for (let i = 0; i < triangles.length; i++)
              expanded.set(
                data.subarray(
                  triangles[i]! * stride,
                  (triangles[i]! + 1) * stride,
                ),
                i * stride,
              );
            return [name, expanded];
          }),
        );
      const attributes = expand(primitive.attributes),
        p = attributes.POSITION!,
        normal = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 9) {
        const ux = p[i + 3]! - p[i]!,
          uy = p[i + 4]! - p[i + 1]!,
          uz = p[i + 5]! - p[i + 2]!;
        const vx = p[i + 6]! - p[i]!,
          vy = p[i + 7]! - p[i + 1]!,
          vz = p[i + 8]! - p[i + 2]!;
        const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        for (let j = 0; j < 3; j++) normal.set(n, i + j * 3);
      }
      attributes.NORMAL = normal;
      return this.upload({
        ...primitive,
        attributes,
        targets: primitive.targets.map(expand),
        mode: 4,
        indices: Uint32Array.from(triangles, (_, i) => i),
      });
    }
    const morph = primitive.targets.length
      ? new MorphTargetData(primitive.targets, count)
      : undefined;
    const skin = SkinVertexData.fromPrimitive(primitive);
    if (skin?.secondary)
      throw new Error("Eight-weight GPU skinning is not supported yet");
    const bits = new Uint32Array(vertices.buffer);
    const normals = primitive.attributes.NORMAL ?? new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const o = i * 26;
      for (let axis = 0; axis < 3; axis++) {
        vertices[o + axis] = positions[i * 3 + axis]!;
        vertices[o + 3 + axis] = colors ? colors[i * colorStride + axis]! : 1;
        vertices[o + 7 + axis] = normals[i * 3 + axis]!;
      }
      vertices[o + 6] = colorStride === 4 ? colors![i * 4 + 3]! : 1;
      for (let axis = 0; axis < 2; axis++) {
        vertices[o + 10 + axis] =
          primitive.attributes.TEXCOORD_0?.[i * 2 + axis] ?? 0;
        vertices[o + 16 + axis] =
          primitive.attributes.TEXCOORD_1?.[i * 2 + axis] ?? 0;
      }
      for (let k = 0; k < 4; k++) {
        bits[o + 18 + k] = skin?.primary.joints[i * 4 + k] ?? 0;
        vertices[o + 22 + k] =
          skin?.primary.weights[i * 4 + k] ?? (k === 0 ? 1 : 0);
      }
      for (let axis = 0; axis < 4; axis++)
        vertices[o + 12 + axis] =
          primitive.attributes.TANGENT?.[i * 4 + axis] ?? 0;
    }
    const source = primitive.indices,
      result: number[] = [];
    if (
      !source.length ||
      (primitive.mode === 1 && source.length % 2) ||
      (primitive.mode === 4 && source.length % 3)
    )
      throw new Error("Invalid primitive index count");
    for (const index of source)
      if (index >= count) throw new Error("Primitive index out of range");
    let topology: 0 | 1 | 2 = 0;
    switch (primitive.mode) {
      case 0:
        topology = 2;
        for (const index of source) result.push(index);
        break;
      case 1:
        topology = 1;
        for (const index of source) result.push(index);
        break;
      case 2:
      case 3:
        topology = 1;
        for (let i = 1; i < source.length; i++)
          result.push(source[i - 1]!, source[i]!);
        if (primitive.mode === 2 && source.length > 1)
          result.push(source[source.length - 1]!, source[0]!);
        break;
      case 4:
        for (const index of source) result.push(index);
        break;
      case 5:
        for (let i = 2; i < source.length; i++)
          result.push(
            source[i - (i % 2 ? 1 : 2)]!,
            source[i - (i % 2 ? 2 : 1)]!,
            source[i]!,
          );
        break;
      case 6:
        for (let i = 2; i < source.length; i++)
          result.push(source[0]!, source[i - 1]!, source[i]!);
        break;
      default:
        throw new Error(`Unsupported primitive mode ${primitive.mode}`);
    }
    if (!result.length) throw new Error("Empty mesh primitive");
    const min = new Float32Array(3).fill(Infinity),
      max = new Float32Array(3).fill(-Infinity);
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis]!, positions[i]!);
      max[axis] = Math.max(max[axis]!, positions[i]!);
    }
    const indices = new Uint32Array(result);
    const morphOffset = morph ? this.morphDeltas?.append(morph) : undefined;
    const vertex = this.resources.buffers.create({
      label: "Asset vertices",
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const index = this.resources.buffers.create({
      label: "Asset indices",
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.queue.writeBuffer(vertex, 0, vertices);
    this.queue.writeBuffer(index, 0, indices);
    return this.register({
      vertex,
      index,
      indexCount: indices.length,
      topology,
      skin,
      morph,
      morphOffset,
      bounds: { min, max },
    });
  }
}
