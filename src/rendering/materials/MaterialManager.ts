import { MATERIAL_PIPELINE_VARIANTS } from "../pipelines/ColorPipelineLayout";
import {
  MaterialShaderRegistry,
  MATERIAL_SHADER_PARAMETER_WORDS,
  MATERIAL_SHADER_PARAMETER_BYTES,
} from "./MaterialShaderRegistry";
import { MATERIAL_WORDS, MATERIAL_BYTES } from "../layouts";
import { Material } from "./Material";
import { MaterialFlags } from "./MaterialFlags";
import { BufferManager } from "../../gpu/BufferManager";
/** CPU material table and shader ABI; revisions invalidate temporal/shadow assumptions. */
export class MaterialManager {
  readonly shaders = new MaterialShaderRegistry();
  readonly shaderIds: Uint16Array;
  readonly shaderParameters: Float32Array;
  shaderUploadBytes = 0;
  private shaderDirtyStart = Infinity;
  private shaderDirtyEnd = 0;
  readonly data: Float32Array;
  readonly flags: Uint32Array;
  readonly alphaMode: Uint8Array;
  readonly doubleSided: Uint8Array;
  count = 0;
  readonly alive: Uint8Array;
  private readonly free: number[] = [];
  /** Computes the this.capacity - this.count + this.free.length result. */
  get available(): number {
    return this.capacity - this.count + this.free.length;
  }
  revision = 0;
  uploadBytes = 0;
  private dirtyStart = Infinity;
  private dirtyEnd = 0;
  /** Initializes packed PBR parameters, material IDs and dirty uploads. */
  constructor(readonly capacity = 2048) {
    this.alive = new Uint8Array(capacity);
    this.shaderIds = new Uint16Array(capacity);
    this.shaderParameters = new Float32Array(
      capacity * MATERIAL_SHADER_PARAMETER_WORDS,
    );
    this.data = new Float32Array(capacity * MATERIAL_WORDS);
    this.flags = new Uint32Array(capacity);
    this.alphaMode = new Uint8Array(capacity);
    this.doubleSided = new Uint8Array(capacity);
  }
  /** Reserves a material ID and initializes validated PBR factors with defaults. */
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
    this.shaderIds[id] = 0;
    this.writeShaderParameters(id);
    this.revision++;
    this.dirtyStart = Math.min(this.dirtyStart, id);
    this.dirtyEnd = Math.max(this.dirtyEnd, id + 1);
  }
  /** Validates and packs material factor changes while marking the material record dirty. */
  set(id: number, material: Material, creating = false): void {
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      id >= (creating ? this.capacity : this.count) ||
      (!creating && !this.alive[id])
    )
      throw new Error("Unknown material");
    const shaderId = material.shaderId ?? 0;
    if (
      !Number.isInteger(shaderId) ||
      shaderId < 0 ||
      (shaderId !== 0 && !this.shaders.get(shaderId))
    )
      throw new Error(
        "Unknown material shader; register it before creating a material",
      );
    this.validateShaderParameters(material.shaderParameters);
    const baseColor = material.baseColor ?? [1, 1, 1, 1],
      metallic = material.metallic ?? 0,
      roughness = material.roughness ?? 1,
      cutoff = material.alphaCutoff ?? 0.5;
    if (
      baseColor.length !== 4 ||
      [...baseColor, metallic, roughness, cutoff].some(
        (v) =>
          /** Evaluates the !Number.isFinite(v) || v < 0 condition. */ !Number.isFinite(
            v,
          ) || v < 0,
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
        (v) =>
          /** Evaluates the v === undefined || !Number.isFinite(v) || v < 0 condition. */ v ===
            undefined ||
          !Number.isFinite(v) ||
          v < 0,
      ) ||
      occlusion > 1
    )
      throw new Error("Invalid PBR properties");
    /** Reads packed texture-coordinate selection for a material. */
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
    this.shaderIds[id] = shaderId;
    this.writeShaderParameters(id, material.shaderParameters);
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
  /** Rejects oversized/nonfinite values before any material state is changed. */
  private validateShaderParameters(values?: ArrayLike<number>): void {
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
  private writeShaderParameters(id: number, values?: ArrayLike<number>): void {
    const offset = id * MATERIAL_SHADER_PARAMETER_WORDS;
    this.shaderParameters.fill(
      0,
      offset,
      offset + MATERIAL_SHADER_PARAMETER_WORDS,
    );
    if (values)
      for (let i = 0; i < values.length; i++)
        this.shaderParameters[offset + i] = values[i]!;
    this.shaderDirtyStart = Math.min(this.shaderDirtyStart, id);
    this.shaderDirtyEnd = Math.max(this.shaderDirtyEnd, id + 1);
  }
  /** Updates only custom parameters, preserving shader choice and PBR/alpha factors. */
  setShaderParameters(id: number, values: ArrayLike<number>): void {
    this.pipelineIndex(id);
    this.validateShaderParameters(values);
    this.writeShaderParameters(id, values);
  }
  /** Selects a registered family without resetting PBR factors or texture metadata; omitted parameters are retained. */
  setShader(
    id: number,
    shaderId: number,
    parameters?: ArrayLike<number>,
  ): void {
    this.pipelineIndex(id);
    if (
      !Number.isInteger(shaderId) ||
      shaderId < 0 ||
      (shaderId !== 0 && !this.shaders.get(shaderId))
    )
      throw new Error("Unknown material shader");
    this.validateShaderParameters(parameters);
    this.shaderIds[id] = shaderId;
    if (parameters) this.writeShaderParameters(id, parameters);
    this.revision++;
  }
  /** Encodes shader family and the existing 18 surface/topology variants without hot-path allocation. */
  colorPipelineIndex(id: number, topology: number): number {
    return (
      this.shaderIds[id]! * MATERIAL_PIPELINE_VARIANTS +
      this.pipelineIndex(id) * 3 +
      topology
    );
  }
  /** Creates one shared parameter buffer only when a custom shader is first installed. */
  createShaderParameterBuffer(manager: BufferManager): GPUBuffer {
    this.shaderDirtyStart = 0;
    this.shaderDirtyEnd = this.count;
    return manager.create({
      label: "Shared custom material parameters",
      size: this.capacity * MATERIAL_SHADER_PARAMETER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
  /** Uploads dirty custom rows once; ordinary unchanged frames perform no parameter writes. */
  uploadShaderParameters(queue: GPUQueue, buffer?: GPUBuffer): void {
    this.shaderUploadBytes = 0;
    if (!buffer || this.shaderDirtyStart === Infinity) return;
    const offset = this.shaderDirtyStart * MATERIAL_SHADER_PARAMETER_BYTES;
    const bytes =
      (this.shaderDirtyEnd - this.shaderDirtyStart) *
      MATERIAL_SHADER_PARAMETER_BYTES;
    if (bytes)
      queue.writeBuffer(
        buffer,
        offset,
        this.shaderParameters.buffer,
        offset,
        bytes,
      );
    this.shaderUploadBytes = bytes;
    this.shaderDirtyStart = Infinity;
    this.shaderDirtyEnd = 0;
  }
  /** Returns the texture layout metadata associated with a material. */
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
  /** Updates texture-coordinate/normal-map metadata and invalidates the packed material state. */
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
  /** Attaches material texture slots while retaining scalar PBR factors. */
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
  /** Encodes alpha mode and sidedness into the bounded material pipeline variant index. */
  pipelineIndex(id: number): number {
    if (id >= this.count || !this.alive[id])
      throw new Error("Unknown material");
    return this.alphaMode[id]! * 2 + this.doubleSided[id]!;
  }
  /** Creates fixed-capacity shared material storage during renderer setup. */
  createBuffer(manager: BufferManager): GPUBuffer {
    this.dirtyStart = 0;
    this.dirtyEnd = this.count;
    return manager.create({
      label: "Shared materials",
      size: this.data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
  /** Writes dirty material records to shared GPU storage and clears their dirty flags. */
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
