import { Resources } from "../gpu/Resources";
import { RuntimePrimitive } from "../assets/gltf/RuntimeAsset";
export interface Mesh {
  vertex: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
  topology: 0 | 1 | 2;
}
/** Shared asset meshes; entities refer to numeric mesh IDs and never own buffers. */
export class MeshManager {
  readonly entries: Mesh[] = [];
  constructor(
    private readonly resources: Resources,
    private readonly queue: GPUQueue,
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
  upload(primitive: RuntimePrimitive): number {
    const positions = primitive.attributes.POSITION!;
    if (!positions || positions.length % 3)
      throw new Error("Invalid mesh positions");
    const count = positions.length / 3,
      vertices = new Float32Array(count * 6),
      colors = primitive.attributes.COLOR_0,
      colorStride = colors ? colors.length / count : 0;
    for (let i = 0; i < count; i++)
      for (let axis = 0; axis < 3; axis++) {
        vertices[i * 6 + axis] = positions[i * 3 + axis]!;
        vertices[i * 6 + 3 + axis] = colors
          ? colors[i * colorStride + axis]!
          : 1;
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
    const indices = new Uint32Array(result);
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
    });
  }
}
