import type { BufferManager } from "../../gpu/BufferManager";
import {
  MATERIAL_SHADER_PARAMETER_WORDS,
  MATERIAL_SHADER_PARAMETER_BYTES,
} from "./MaterialShaderRegistry";
/** Owns fixed-size custom rows and their independent upload range; PBR packing stays in MaterialManager. */
export class MaterialShaderParameters {
  readonly data: Float32Array;
  private dirtyStart = Infinity;
  private dirtyEnd = 0;
  /** Allocate CPU rows; GPU storage remains lazy until a shader family is installed. */
  constructor(private readonly capacity: number) {
    this.data = new Float32Array(capacity * MATERIAL_SHADER_PARAMETER_WORDS);
  }
  /** Rejects oversized/nonfinite values before any material state is changed. */
  validate(values?: ArrayLike<number>): void {
    if (!values) return;
    if (
      !Number.isInteger(values.length) ||
      values.length < 0 ||
      values.length > MATERIAL_SHADER_PARAMETER_WORDS
    )
      throw new Error("Material shader parameters require at most 16 values");
    for (let i = 0; i < values.length; i++)
      if (
        !Number.isFinite(values[i]) ||
        !Number.isFinite(Math.fround(values[i]!))
      )
        throw new Error("Material shader parameters must be finite f32 values");
  }
  /** Writes a zero-padded shared parameter row and marks its byte range dirty. */
  write(id: number, values?: ArrayLike<number>): void {
    const offset = id * MATERIAL_SHADER_PARAMETER_WORDS;
    this.data.fill(0, offset, offset + MATERIAL_SHADER_PARAMETER_WORDS);
    if (values)
      for (let i = 0; i < values.length; i++)
        this.data[offset + i] = values[i]!;
    this.dirtyStart = Math.min(this.dirtyStart, id);
    this.dirtyEnd = Math.max(this.dirtyEnd, id + 1);
  }
  /** Creates one shared parameter buffer only when a custom shader is first installed. */
  createBuffer(manager: BufferManager, count: number): GPUBuffer {
    this.dirtyStart = 0;
    this.dirtyEnd = count;
    return manager.create({
      label: "Shared custom material parameters",
      size: this.capacity * MATERIAL_SHADER_PARAMETER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
  /** Uploads dirty custom rows once; ordinary unchanged frames perform no parameter writes. */
  upload(queue: GPUQueue, buffer?: GPUBuffer): number {
    if (!buffer || this.dirtyStart === Infinity) return 0;
    const offset = this.dirtyStart * MATERIAL_SHADER_PARAMETER_BYTES;
    const bytes =
      (this.dirtyEnd - this.dirtyStart) * MATERIAL_SHADER_PARAMETER_BYTES;
    if (bytes)
      queue.writeBuffer(buffer, offset, this.data.buffer, offset, bytes);
    this.dirtyStart = Infinity;
    this.dirtyEnd = 0;
    return bytes;
  }
}
