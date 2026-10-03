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
  append(data: MorphTargetData): number {
    const count = data.targetCount * data.vertexCount;
    const offset = this.arena.allocate(count);
    try {
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
      return offset;
    } catch (error) {
      this.arena.release(offset);
      throw error;
    }
  }
}
