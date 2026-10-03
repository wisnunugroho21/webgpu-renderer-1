import { Material } from "./Material";
import { MaterialFlags } from "./MaterialFlags";
import { BufferManager } from "../../gpu/BufferManager";
export class MaterialManager {
  readonly data: Float32Array;
  readonly flags: Uint32Array;
  readonly alphaMode: Uint8Array;
  readonly doubleSided: Uint8Array;
  count = 0;
  uploadBytes = 0;
  private dirtyStart = Infinity;
  private dirtyEnd = 0;
  constructor(readonly capacity = 2048) {
    this.data = new Float32Array(capacity * 8);
    this.flags = new Uint32Array(capacity);
    this.alphaMode = new Uint8Array(capacity);
    this.doubleSided = new Uint8Array(capacity);
  }
  create(material: Material = {}): number {
    if (this.count === this.capacity)
      throw new Error("Material capacity exceeded");
    const id = this.count;
    this.set(id, material, true);
    this.count++;
    return id;
  }
  set(id: number, material: Material, creating = false): void {
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      id >= (creating ? this.capacity : this.count)
    )
      throw new Error("Unknown material");
    const baseColor = material.baseColor ?? [1, 1, 1, 1],
      metallic = material.metallic ?? 0,
      roughness = material.roughness ?? 1,
      cutoff = material.alphaCutoff ?? 0.5;
    if (
      [...baseColor, metallic, roughness, cutoff].some(
        (v) => !Number.isFinite(v) || v < 0,
      ) ||
      metallic > 1 ||
      roughness > 1 ||
      baseColor[3] > 1 ||
      cutoff > 1
    )
      throw new Error("Invalid material values");
    const mode = material.alphaMode ?? "OPAQUE",
      alpha =
        mode === "OPAQUE" ? 0 : mode === "MASK" ? 1 : mode === "BLEND" ? 2 : -1;
    if (alpha < 0) throw new Error("Invalid alpha mode");
    const offset = id * 8;
    this.data.set(baseColor, offset);
    this.data.set([metallic, roughness, alpha, cutoff], offset + 4);
    this.alphaMode[id] = alpha;
    this.doubleSided[id] = material.doubleSided ? 1 : 0;
    this.flags[id] =
      (alpha === 1 ? MaterialFlags.ALPHA_MASK : 0) |
      (material.doubleSided ? MaterialFlags.DOUBLE_SIDED : 0);
    this.dirtyStart = Math.min(this.dirtyStart, id);
    this.dirtyEnd = Math.max(this.dirtyEnd, id + 1);
  }
  pipelineIndex(id: number): number {
    if (id >= this.count) throw new Error("Unknown material");
    return this.alphaMode[id]! * 2 + this.doubleSided[id]!;
  }
  createBuffer(manager: BufferManager): GPUBuffer {
    this.dirtyStart = 0;
    this.dirtyEnd = this.count;
    return manager.create({
      label: "Shared materials",
      size: this.data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
  upload(queue: GPUQueue, buffer: GPUBuffer): void {
    this.uploadBytes = 0;
    if (this.dirtyStart === Infinity) return;
    const byteOffset = this.dirtyStart * 32,
      byteLength = (this.dirtyEnd - this.dirtyStart) * 32;
    queue.writeBuffer(
      buffer,
      byteOffset,
      this.data.buffer,
      byteOffset,
      byteLength,
    );
    this.uploadBytes = byteLength;
    this.dirtyStart = Infinity;
    this.dirtyEnd = 0;
  }
}
