/** Fixed shared parameter row: four vec4 values, indexed by the existing material ID. */
export const MATERIAL_SHADER_PARAMETER_WORDS = 16;
export const MATERIAL_SHADER_PARAMETER_BYTES = 64;
export const MAX_MATERIAL_SHADER_FAMILIES = 16;

/** Surface-only WGSL extension. Geometry and coverage remain owned by the renderer. */
export interface MaterialShaderDefinition {
  readonly name: string;
  /** Defines shadeMaterial(surface: MaterialSurface, parameters: MaterialShaderParameters) -> vec3<f32>. */
  readonly source: string;
}
export interface RegisteredMaterialShader extends MaterialShaderDefinition {
  readonly id: number;
}

/** CPU provenance survives device loss; family zero remains the unchanged built-in PBR path. */
export class MaterialShaderRegistry {
  private readonly entries: RegisteredMaterialShader[] = [];
  /** Returns registered immutable definitions in stable ID order, excluding built-in PBR. */
  get definitions(): readonly RegisteredMaterialShader[] {
    return this.entries;
  }
  /** Resolves a committed custom family; zero denotes built-in PBR and has no definition. */
  get(id: number): RegisteredMaterialShader | undefined {
    return this.entries[id - 1];
  }
  /** Validates the surface-only contract and reserves a candidate without publishing it. */
  candidate(definition: MaterialShaderDefinition): RegisteredMaterialShader {
    const name = definition.name?.trim();
    const source = definition.source?.trim();
    if (
      !name ||
      name.length > 128 ||
      !source ||
      source.length > 65536 ||
      new TextEncoder().encode(source).byteLength > 65536
    )
      throw new Error(
        "Material shader requires a name and bounded WGSL source",
      );
    const existing = this.entries.find(
      (entry) =>
        /** Resolve stable name identity before assigning a new family ID. */ entry.name ===
        name,
    );
    if (existing) {
      if (existing.source !== source)
        throw new Error(
          "Material shader name already has a different definition",
        );
      return existing;
    }
    if (this.entries.length >= MAX_MATERIAL_SHADER_FAMILIES)
      throw new Error("Material shader family capacity exceeded");
    // Remove comments before checking prohibited tokens; WGSL has no string literals.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ");
    if (!/\bfn\s+shadeMaterial\s*\(/.test(code))
      throw new Error("Material shader must define shadeMaterial");
    if (/@|\b(discard|enable|requires|override)\b/.test(code))
      throw new Error(
        "Material shaders cannot declare bindings, entry points or custom coverage",
      );
    return Object.freeze({ name, source, id: this.entries.length + 1 });
  }
  /** Publishes only after GPU validation; existing identical registrations retain their ID. */
  commit(candidate: RegisteredMaterialShader): void {
    const existing = this.get(candidate.id);
    if (existing === candidate) return;
    if (candidate.id !== this.entries.length + 1)
      throw new Error("Material shader registration order changed");
    this.entries.push(candidate);
  }
}
