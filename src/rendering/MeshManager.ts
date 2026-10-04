import { prepareMesh, PreparedMesh } from "./geometry/prepareMesh";
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
    return this.uploadPrepared(primitive.prepared ?? prepareMesh(primitive));
  }
  private uploadPrepared(prepared: PreparedMesh): number {
    const transaction = this.beginUpload(prepared);
    try {
      this.queue.writeBuffer(transaction.vertex, 0, prepared.vertices);
      this.queue.writeBuffer(transaction.index, 0, prepared.indices);
      return transaction.publish();
    } catch (error) {
      transaction.rollback();
      throw error;
    }
  }
  /** Large prepared uploads yield between bounded writes and cancel transactionally. */
  async uploadAsync(
    primitive: RuntimePrimitive,
    check: () => void,
  ): Promise<number> {
    const prepared = primitive.prepared ?? prepareMesh(primitive),
      chunkBytes = 1024 * 1024;
    check();
    if (
      prepared.vertices.byteLength + prepared.indices.byteLength <=
      chunkBytes
    )
      return this.uploadPrepared(prepared);
    const transaction = this.beginUpload(prepared);
    try {
      const write = async (
        buffer: GPUBuffer,
        data: Float32Array | Uint32Array,
      ) => {
        for (let start = 0; start < data.length; start += chunkBytes / 4) {
          check();
          this.queue.writeBuffer(
            buffer,
            start * 4,
            data.subarray(start, Math.min(data.length, start + chunkBytes / 4)),
          );
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      };
      await write(transaction.vertex, prepared.vertices);
      await write(transaction.index, prepared.indices);
      check();
      return transaction.publish();
    } catch (error) {
      transaction.rollback();
      throw error;
    }
  }
  /** One allocation/publication/rollback path for synchronous and scheduled uploads. */
  private beginUpload(prepared: PreparedMesh) {
    const {
      vertices,
      indices,
      count,
      topology,
      skin,
      morph,
      clusters,
      bounds,
    } = prepared;
    if (skin?.secondary && !this.morphDeltas)
      throw new Error("Eight-weight skinning requires a deformation arena");
    const morphOffset =
      morph || skin?.secondary
        ? this.morphDeltas?.append(morph, skin?.secondary, count)
        : undefined;
    let vertex: GPUBuffer | undefined, index: GPUBuffer | undefined;
    const rollback = () => {
      if (vertex) this.resources.buffers.destroy(vertex);
      if (index) this.resources.buffers.destroy(index);
      if (morphOffset !== undefined) this.morphDeltas?.release(morphOffset);
    };
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
    } catch (error) {
      rollback();
      throw error;
    }
    return {
      vertex,
      index,
      rollback,
      publish: () => {
        const id = this.register({
          clusters,
          vertex: vertex!,
          index: index!,
          indexCount: indices.length,
          topology,
          skin,
          morph,
          morphOffset,
          deformationVertexCount: morph || skin?.secondary ? count : undefined,
          bounds,
        });
        this.recovery.set(id, { vertices, indices });
        return id;
      },
    };
  }
}
