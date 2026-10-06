import { packTextureLayout } from "./MaterialTextureLayout";
import { MATERIAL_PIPELINE_VARIANTS } from "../pipelines/ColorPipelineLayout";
import { MaterialShaderRegistry } from "./MaterialShaderRegistry";
import { MaterialShaderParameters } from "./MaterialShaderParameters";
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
  private readonly customParameters: MaterialShaderParameters;
  readonly data: Float32Array;
  readonly flags: Uint32Array;
  readonly alphaMode: Uint8Array;
  readonly doubleSided: Uint8Array;
  count = 0;
  readonly alive: Uint8Array;
  readonly generations: Float64Array;
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
    this.generations = new Float64Array(capacity);
    this.shaderIds = new Uint16Array(capacity);
    this.customParameters = new MaterialShaderParameters(capacity);
    this.shaderParameters = this.customParameters.data;
    this.data = new Float32Array(capacity * MATERIAL_WORDS);
    this.flags = new Uint32Array(capacity);
    this.alphaMode = new Uint8Array(capacity);
    this.doubleSided = new Uint8Array(capacity);
  }
  /** Reserves a material ID and initializes validated PBR factors with defaults. */
  create(material: Material = {}): number {
    if (!this.available) throw new Error("Material capacity exceeded");
    const id = this.free.at(-1) ?? this.count;
    if (this.generations[id] === Number.MAX_SAFE_INTEGER)
      throw new Error("Material generation exhausted");
    this.set(id, material, true);
    if (id === this.count) this.count++;
    else this.free.pop();
    this.alive[id] = 1;
    this.generations[id]!++;
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
    this.customParameters.write(id);
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
    this.customParameters.validate(material.shaderParameters);
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
    const layout = packTextureLayout(material.textures),
      ior = material.ior ?? 1.5,
      specular = material.specular ?? 1,
      specularColor = material.specularColor ?? [1, 1, 1],
      clearcoat = material.clearcoat ?? 0,
      coatRoughness = material.clearcoatRoughness ?? 0,
      coatNormalScale = material.clearcoatNormalScale ?? 1,
      strength = material.emissiveStrength ?? 1;
    if (
      specularColor.length !== 3 ||
      [
        ior,
        specular,
        ...Array.from(specularColor),
        clearcoat,
        coatRoughness,
        coatNormalScale,
        strength,
      ].some(
        (v) =>
          /** Reject invalid or unrepresentable authored factors before any record mutation. */ !Number.isFinite(
            Math.fround(v),
          ) || v < 0,
      ) ||
      (ior !== 0 && ior < 1) ||
      specular > 1 ||
      clearcoat > 1 ||
      coatRoughness > 1
    )
      throw new Error("Invalid authored PBR properties");
    const transmission = material.transmission ?? 0,
      thickness = material.thickness ?? 0,
      attenuationDistance = material.attenuationDistance ?? Infinity,
      attenuationColor = material.attenuationColor ?? [1, 1, 1];
    if (
      !Number.isFinite(Math.fround(transmission)) ||
      transmission < 0 ||
      transmission > 1 ||
      !Number.isFinite(Math.fround(thickness)) ||
      thickness < 0 ||
      attenuationColor.length !== 3 ||
      Array.from(attenuationColor).some((v) => {
        // Absorption must never amplify transmitted radiance or publish nonfinite factors.
        return !Number.isFinite(Math.fround(v)) || v < 0 || v > 1;
      }) ||
      (attenuationDistance !== Infinity &&
        (!Number.isFinite(Math.fround(attenuationDistance)) ||
          Math.fround(attenuationDistance) <= 0)) ||
      (material.unlit && transmission > 0)
    )
      throw new Error("Invalid transmission/volume properties");
    /** Read the validated UV index for legacy metadata fields. */
    const uv = (role: string) => material.textures?.[role]?.texCoord ?? 0;
    this.shaderIds[id] = shaderId;
    this.customParameters.write(id, material.shaderParameters);
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
        material.doubleSided && thickness === 0 ? 1 : 0,
      ],
      offset + 12,
    );
    this.data.set(
      [uv("baseColor"), uv("metallicRoughness"), uv("normal"), uv("occlusion")],
      offset + 16,
    );
    this.data.set(
      [ior, specular, strength, material.unlit ? 1 : 0],
      offset + 20,
    );
    this.data.set(
      [specularColor[0]!, specularColor[1]!, specularColor[2]!, clearcoat],
      offset + 24,
    );
    this.data.set(
      [coatRoughness, coatNormalScale, 0, layout[102]!],
      offset + 28,
    );
    this.data.set(layout.subarray(6, 102), offset + 40);
    this.data.set([transmission, thickness, 0, 0], offset + 32);
    this.data.set(
      [
        attenuationColor[0]!,
        attenuationColor[1]!,
        attenuationColor[2]!,
        attenuationDistance === Infinity ? 0 : attenuationDistance,
      ],
      offset + 36,
    );
    this.alphaMode[id] = transmission > 0 ? 2 : alpha;
    this.doubleSided[id] = material.doubleSided && thickness === 0 ? 1 : 0;
    this.flags[id] =
      (alpha === 1 ? MaterialFlags.ALPHA_MASK : 0) |
      (material.doubleSided && thickness === 0
        ? MaterialFlags.DOUBLE_SIDED
        : 0);
    this.revision++;
    this.dirtyStart = Math.min(this.dirtyStart, id);
    this.dirtyEnd = Math.max(this.dirtyEnd, id + 1);
  }
  /** Updates only custom parameters, preserving shader choice and PBR/alpha factors. */
  setShaderParameters(id: number, values: ArrayLike<number>): void {
    this.pipelineIndex(id);
    this.customParameters.validate(values);
    this.customParameters.write(id, values);
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
    this.customParameters.validate(parameters);
    this.shaderIds[id] = shaderId;
    if (parameters) this.customParameters.write(id, parameters);
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
  /** Creates lazy shared storage and marks all live rows for recovery upload. */
  createShaderParameterBuffer(manager: BufferManager): GPUBuffer {
    return this.customParameters.createBuffer(manager, this.count);
  }
  /** Report bytes uploaded while preserving the public diagnostics field. */
  uploadShaderParameters(queue: GPUQueue, buffer?: GPUBuffer): void {
    this.shaderUploadBytes = 0;
    this.shaderUploadBytes = this.customParameters.upload(queue, buffer);
  }
  /** Returns the texture layout metadata associated with a material. */
  textureLayout(id: number, extended = false): Float32Array {
    if (!Number.isInteger(id) || id < 0 || id >= this.count || !this.alive[id])
      throw new Error("Unknown material");
    const o = id * MATERIAL_WORDS;
    const layout = new Float32Array([
      this.data[o + 13]!,
      this.data[o + 14]!,
      this.data[o + 16]!,
      this.data[o + 17]!,
      this.data[o + 18]!,
      this.data[o + 19]!,
    ]);
    if (!extended) return layout;
    const complete = new Float32Array(103);
    complete.set(layout);
    complete.set(this.data.subarray(o + 40, o + 136), 6);
    complete[102] = this.data[o + 31]!;
    return complete;
  }
  /** Updates texture-coordinate/normal-map metadata and invalidates the packed material state. */
  setTextureLayout(id: number, layout: ArrayLike<number>): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.count || !this.alive[id])
      throw new Error("Unknown material");
    if (![6, 87, 103].includes(layout.length))
      throw new Error("Invalid texture layout");
    for (let i = 0; i < 6; i++)
      if (layout[i] !== 0 && layout[i] !== 1)
        throw new Error("Only TEXCOORD_0/1 are supported");
    if (layout.length > 6) {
      for (let i = 6; i < layout.length - 1; i++)
        if (!Number.isFinite(Math.fround(layout[i]!)))
          throw new Error("Invalid texture transform");
      const flags = layout[layout.length - 1]!;
      if (
        !Number.isInteger(flags) ||
        flags < 0 ||
        flags > (layout.length === 87 ? 31 : 127)
      )
        throw new Error("Invalid texture flags");
      for (let i = 6; i < layout.length - 1; i += 8)
        if (
          (layout[i + 3] !== 0 && layout[i + 3] !== 1) ||
          (layout[i + 7] !== 0 && layout[i + 7] !== 1)
        )
          throw new Error("Invalid texture transform");
    }
    const o = id * MATERIAL_WORDS;
    this.data[o + 13] = layout[0]!;
    this.data[o + 14] = layout[1]!;
    for (let i = 0; i < 4; i++) this.data[o + 16 + i] = layout[i + 2]!;
    if (layout.length > 6) {
      this.data.set(Array.from(layout).slice(6, -1), o + 40);
      this.data[o + 31] =
        layout.length === 103
          ? layout[102]!
          : (this.data[o + 31]! & 96) | layout[86]!;
    }
    this.revision++;
    this.dirtyStart = Math.min(this.dirtyStart, id);
    this.dirtyEnd = Math.max(this.dirtyEnd, id + 1);
  }
  /** Attaches material texture slots while retaining scalar PBR factors. */
  setTextureSlots(id: number, slots: NonNullable<Material["textures"]>): void {
    this.setTextureLayout(id, packTextureLayout(slots));
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
