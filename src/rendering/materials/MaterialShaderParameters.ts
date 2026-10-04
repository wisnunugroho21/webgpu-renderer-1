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
  /** Replace one 16-float row, zero-pad unused values and expand the pending row range.
   * MaterialManager validates IDs/values before calling this method so invalid updates cannot partially mutate storage. */
  write(id: number, values?: ArrayLike<number>): void {
    const offset = id * MATERIAL_SHADER_PARAMETER_WORDS;
    this.data.fill(0, offset, offset + MATERIAL_SHADER_PARAMETER_WORDS);
    if (values)
      for (let i = 0; i < values.length; i++)
        this.data[offset + i] = values[i]!;
    this.dirtyStart = Math.min(this.dirtyStart, id);
    this.dirtyEnd = Math.max(this.dirtyEnd, id + 1);
  }
  /** Allocate capacity × 64 bytes for all materials and mark existing rows for upload.
   * First installation and device recovery use the same CPU table; no per-material buffer is created. */
  createBuffer(manager: BufferManager, count: number): GPUBuffer {
    this.dirtyStart = 0;
    this.dirtyEnd = count;
    return manager.create({
      label: "Shared custom material parameters",
      size: this.capacity * MATERIAL_SHADER_PARAMETER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
  /** Return the uploaded byte count, coalescing dirty rows into one writeBuffer call.
   * Missing GPU storage and failed writes retain pending rows; successful writes clear them. Unchanged frames return zero. */
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
