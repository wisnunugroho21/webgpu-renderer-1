import { Influences } from "../animation/skinning/SkinVertexData";
import { RangeAllocator } from "../assets/RangeAllocator";
import { Resources } from "../gpu/Resources";
import { MorphTargetData } from "../animation/MorphTargetData";
/** Three shared, vec4-aligned delta streams, stored target-major then vertex-major. */
export class MorphDeltaBuffers {
  readonly position: GPUBuffer;
  readonly normal: GPUBuffer;
  readonly tangent: GPUBuffer;
  private readonly arena: RangeAllocator;
  get count(): number {
    return this.arena.count;
  }
  release(offset: number): void {
    this.arena.release(offset);
  }
  uploadBytes = 0;
  constructor(
    resources: Resources,
    private readonly queue: GPUQueue,
    readonly capacity = 500000,
  ) {
    this.arena = new RangeAllocator(capacity);
    const create = (label: string) =>
      resources.buffers.create({
        label,
        size: capacity * 16,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_DST |
          GPUBufferUsage.COPY_SRC,
      });
    this.position = create("Shared morph position deltas");
    this.normal = create("Shared morph normal deltas");
    this.tangent = create("Shared morph tangent deltas");
  }
  append(
    data?: MorphTargetData,
    secondary?: Influences,
    vertexCount = data?.vertexCount ?? 0,
  ): number {
    const morphCount = data ? data.targetCount * data.vertexCount : 0,
      count = morphCount + (secondary ? vertexCount * 2 : 0);
    if (!count) throw new Error("Empty deformation stream");
    const offset = this.arena.allocate(count);
    try {
      if (data)
        for (const [semantic, buffer] of [
          ["POSITION", this.position],
          ["NORMAL", this.normal],
          ["TANGENT", this.tangent],
        ] as const) {
          const packed = new Float32Array(count * 4);
          for (let t = 0; t < data.targetCount; t++) {
            const stream = data.targets[t]![semantic];
            if (!stream) continue;
            for (let v = 0; v < data.vertexCount; v++)
              for (let axis = 0; axis < 3; axis++)
                packed[(t * data.vertexCount + v) * 4 + axis] =
                  stream[v * 3 + axis]!;
          }
          this.queue.writeBuffer(buffer, offset * 16, packed);
          this.uploadBytes += packed.byteLength;
        }
      if (secondary) {
        // Two vec4 records per vertex: exactly representable numeric joint IDs, then weights.
        // Sharing the existing tangent arena keeps vertex storage bindings within WebGPU limits.
        const packed = new Float32Array(vertexCount * 8);
        for (let v = 0; v < vertexCount; v++)
          for (let k = 0; k < 4; k++) {
            packed[v * 8 + k] = secondary.joints[v * 4 + k]!;
            packed[v * 8 + 4 + k] = secondary.weights[v * 4 + k]!;
          }
        this.queue.writeBuffer(
          this.tangent,
          (offset + morphCount) * 16,
          packed,
        );
        this.uploadBytes += packed.byteLength;
      }
      return offset;
    } catch (error) {
      this.arena.release(offset);
      throw error;
    }
  }
}
