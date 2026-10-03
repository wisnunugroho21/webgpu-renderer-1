import { MATERIAL_WORDS, MATERIAL_BYTES } from "../layouts";
import { Material } from "./Material";
import { MaterialFlags } from "./MaterialFlags";
import { BufferManager } from "../../gpu/BufferManager";
/** CPU material table and shader ABI; revisions invalidate temporal/shadow assumptions. */
export class MaterialManager {
  readonly data: Float32Array;
  readonly flags: Uint32Array;
  readonly alphaMode: Uint8Array;
  readonly doubleSided: Uint8Array;
  count = 0;
  readonly alive: Uint8Array;
  private readonly free: number[] = [];
  get available(): number {
    return this.capacity - this.count + this.free.length;
  }
  revision = 0;
  uploadBytes = 0;
  private dirtyStart = Infinity;
  private dirtyEnd = 0;
  constructor(readonly capacity = 2048) {
    this.alive = new Uint8Array(capacity);
    this.data = new Float32Array(capacity * MATERIAL_WORDS);
    this.flags = new Uint32Array(capacity);
    this.alphaMode = new Uint8Array(capacity);
    this.doubleSided = new Uint8Array(capacity);
  }
  create(material: Material = {}): number {
    if (!this.available) throw new Error("Material capacity exceeded");
    const id = this.free.at(-1) ?? this.count;
    this.set(id, material, true);
    if (id === this.count) this.count++;
    else this.free.pop();
    this.alive[id] = 1;
    return id;
  }
  /** Caller must detach references and fence GPU work before making a slot reusable. */
  release(id: number): void {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.free.push(id);
    this.data.fill(0, id * MATERIAL_WORDS, (id + 1) * MATERIAL_WORDS);
    this.flags[id] = this.alphaMode[id] = this.doubleSided[id] = 0;
    this.revision++;
    this.dirtyStart = Math.min(this.dirtyStart, id);
    this.dirtyEnd = Math.max(this.dirtyEnd, id + 1);
  }
  set(id: number, material: Material, creating = false): void {
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      id >= (creating ? this.capacity : this.count) ||
      (!creating && !this.alive[id])
    )
      throw new Error("Unknown material");
    const baseColor = material.baseColor ?? [1, 1, 1, 1],
      metallic = material.metallic ?? 0,
      roughness = material.roughness ?? 1,
      cutoff = material.alphaCutoff ?? 0.5;
    if (
      baseColor.length !== 4 ||
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
    const offset = id * MATERIAL_WORDS;
    const emissive = material.emissive ?? [0, 0, 0],
      normalScale = material.normalScale ?? 1,
      occlusion = material.occlusionStrength ?? 1;
    if (
      [emissive[0], emissive[1], emissive[2], normalScale, occlusion].some(
        (v) => v === undefined || !Number.isFinite(v) || v < 0,
      ) ||
      occlusion > 1
    )
      throw new Error("Invalid PBR properties");
    const uv = (role: string) => material.textures?.[role]?.texCoord ?? 0;
    for (const role of [
      "baseColor",
      "metallicRoughness",
      "normal",
      "occlusion",
      "emissive",
    ])
      if (![0, 1].includes(uv(role)))
        throw new Error("Only TEXCOORD_0/1 are supported");
    this.data.set(baseColor, offset);
    this.data.set([metallic, roughness, alpha, cutoff], offset + 4);
    this.data.set(
      [emissive[0]!, emissive[1]!, emissive[2]!, normalScale],
      offset + 8,
    );
    this.data.set(
      [
        occlusion,
        uv("emissive"),
        material.textures?.normal ? 1 : 0,
        material.doubleSided ? 1 : 0,
      ],
      offset + 12,
    );
    this.data.set(
      [uv("baseColor"), uv("metallicRoughness"), uv("normal"), uv("occlusion")],
      offset + 16,
    );
    this.alphaMode[id] = alpha;
    this.doubleSided[id] = material.doubleSided ? 1 : 0;
    this.flags[id] =
      (alpha === 1 ? MaterialFlags.ALPHA_MASK : 0) |
      (material.doubleSided ? MaterialFlags.DOUBLE_SIDED : 0);
    this.revision++;
    this.dirtyStart = Math.min(this.dirtyStart, id);
    this.dirtyEnd = Math.max(this.dirtyEnd, id + 1);
  }
  textureLayout(id: number): Float32Array {
    if (!Number.isInteger(id) || id < 0 || id >= this.count || !this.alive[id])
      throw new Error("Unknown material");
    const o = id * MATERIAL_WORDS;
    return new Float32Array([
      this.data[o + 13]!,
      this.data[o + 14]!,
      this.data[o + 16]!,
      this.data[o + 17]!,
      this.data[o + 18]!,
      this.data[o + 19]!,
    ]);
  }
  setTextureLayout(id: number, layout: ArrayLike<number>): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.count || !this.alive[id])
      throw new Error("Unknown material");
    if (layout.length !== 6) throw new Error("Invalid texture layout");
    for (let i = 0; i < 6; i++)
      if (layout[i] !== 0 && layout[i] !== 1)
        throw new Error("Only TEXCOORD_0/1 are supported");
    const o = id * MATERIAL_WORDS;
    this.data[o + 13] = layout[0]!;
    this.data[o + 14] = layout[1]!;
    for (let i = 2; i < 6; i++) this.data[o + 14 + i] = layout[i]!;
    this.revision++;
    this.dirtyStart = Math.min(this.dirtyStart, id);
    this.dirtyEnd = Math.max(this.dirtyEnd, id + 1);
  }
  setTextureSlots(id: number, slots: NonNullable<Material["textures"]>): void {
    this.setTextureLayout(id, [
      slots.emissive?.texCoord ?? 0,
      slots.normal ? 1 : 0,
      slots.baseColor?.texCoord ?? 0,
      slots.metallicRoughness?.texCoord ?? 0,
      slots.normal?.texCoord ?? 0,
      slots.occlusion?.texCoord ?? 0,
    ]);
  }
  pipelineIndex(id: number): number {
    if (id >= this.count || !this.alive[id])
      throw new Error("Unknown material");
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
    const byteOffset = this.dirtyStart * MATERIAL_BYTES,
      byteLength = (this.dirtyEnd - this.dirtyStart) * MATERIAL_BYTES;
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
