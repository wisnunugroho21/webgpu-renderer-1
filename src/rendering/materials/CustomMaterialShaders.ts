import type { MaterialManager } from "./MaterialManager";
import type {
  MaterialShaderDefinition,
  RegisteredMaterialShader,
} from "./MaterialShaderRegistry";
import type {
  ColorResources,
  ColorResourcesInput,
} from "../pipelines/ColorResources";
import { createColorResources } from "../pipelines/createColorResources";
import { colorShaderSource } from "../pipelines/colorShaderSource";

interface CustomMaterialShaderContext extends ColorResourcesInput {
  readonly materials: MaterialManager;
}

/** Owns cold shader registration, family variants and shared parameters; color drawing reads prepared tables. */
export class CustomMaterialShaders {
  private environmentLayout?: GPUBindGroupLayout;
  private hdrPrepared = false;
  private parameterBuffer?: GPUBuffer;
  readonly families: Array<ColorResources> = [];
  readonly hdrFamilies: Array<ColorResources> = [];
  readonly environmentFamilies: Array<ColorResources> = [];
  readonly hdrEnvironmentFamilies: Array<ColorResources> = [];
  private registration: Promise<unknown> = Promise.resolve();
  /** Replays committed definitions in their original order when a renderer is created or recovered. */
  constructor(
    private readonly scene: CustomMaterialShaderContext,
    base: ColorResources,
  ) {
    this.families[0] = base;
    for (const shader of scene.materials.shaders.definitions)
      this.prepareFamily(shader);
  }
  /** Prepares HDR tables after the standard PBR HDR targets/layouts are installed. */
  prepareHDR(): void {
    this.hdrPrepared = true;
    this.prepareHDRFamilies();
    this.prepareEnvironmentFamilies();
  }
  /** Installs the shared environment layout and prepares matching retained family tables. */
  prepareEnvironment(layout: GPUBindGroupLayout): void {
    this.environmentLayout = layout;
    this.prepareEnvironmentFamilies();
  }
  /** Allocates the single shared parameter table only on the first custom-family setup. */
  private ensureParameterBuffer(): GPUBuffer {
    return (this.parameterBuffer ??=
      this.scene.materials.createShaderParameterBuffer(
        this.scene.resources.buffers,
      ));
  }
  /** Prepares one family against the default color target; recovery replays committed CPU definitions. */
  private prepareFamily(shader: RegisteredMaterialShader): void {
    this.families[shader.id] ??= createColorResources({
      sharedBindings: this.families[1]?.bindings,
      ...this.scene,
      shader,
      shaderParameterBuffer: this.ensureParameterBuffer(),
    });
  }
  /** Prepares retained HDR variants during feature setup, never during drawing. */
  private prepareHDRFamilies(): void {
    if (!this.hdrPrepared) return;
    for (const shader of this.scene.materials.shaders.definitions)
      this.hdrFamilies[shader.id] ??= createColorResources({
        sharedBindings: this.hdrFamilies[1]?.bindings,
        ...this.scene,
        shader,
        colorFormat: "rgba16float",
        shaderParameterBuffer: this.ensureParameterBuffer(),
      });
  }
  /** Prepares environment-compatible family layouts when the shared environment layout becomes available. */
  private prepareEnvironmentFamilies(): void {
    if (!this.environmentLayout) return;
    for (const shader of this.scene.materials.shaders.definitions) {
      this.environmentFamilies[shader.id] ??= createColorResources({
        sharedBindings: this.environmentFamilies[1]?.bindings,
        ...this.scene,
        shader,
        environmentLayout: this.environmentLayout,
        shaderParameterBuffer: this.ensureParameterBuffer(),
      });
      if (this.hdrPrepared)
        this.hdrEnvironmentFamilies[shader.id] ??= createColorResources({
          sharedBindings: this.hdrEnvironmentFamilies[1]?.bindings,
          ...this.scene,
          shader,
          colorFormat: "rgba16float",
          environmentLayout: this.environmentLayout,
          shaderParameterBuffer: this.ensureParameterBuffer(),
        });
    }
  }
  /** Serializes registration so concurrent names/IDs publish in a stable order after validation. */
  registerShader(definition: MaterialShaderDefinition): Promise<number> {
    const snapshot = { ...definition };
    const result = this.registration.then(() => {
      // Install the call-time definition after earlier registrations settle.
      return this.installShader(snapshot);
    });
    this.registration = result.catch(() => {
      /* Failure does not prevent a later valid registration. */
    });
    return result;
  }
  /** Validates assembled WGSL before preparing pipeline variants and publishing the material family. */
  private async installShader(
    definition: MaterialShaderDefinition,
  ): Promise<number> {
    const { gpu, materials } = this.scene;
    if (gpu.lost || gpu.disposed) throw new Error("GPU device unavailable");
    const shader = materials.shaders.candidate(definition);
    if (materials.shaders.get(shader.id)) return shader.id;
    gpu.device.pushErrorScope("validation");
    let failure: unknown;
    try {
      const probe = gpu.device.createShaderModule({
        label: shader.name,
        code: colorShaderSource({ shader }),
      });
      const messages = (await probe.getCompilationInfo()).messages.filter(
        (message) =>
          /** Keep only fatal compilation diagnostics. */ message.type ===
          "error",
      );
      if (messages.length)
        throw new Error(
          messages
            .map(
              (message) =>
                /** Format shader diagnostics with source coordinates. */ `${message.lineNum}:${message.linePos} ${message.message}`,
            )
            .join("\n"),
        );
      if (gpu.lost || gpu.disposed) throw new Error("GPU device unavailable");
      this.prepareFamily(shader);
      if (this.hdrPrepared)
        this.hdrFamilies[shader.id] = createColorResources({
          sharedBindings: this.hdrFamilies[1]?.bindings,
          ...this.scene,
          shader,
          colorFormat: "rgba16float",
          shaderParameterBuffer: this.ensureParameterBuffer(),
        });
      if (this.environmentLayout) {
        this.environmentFamilies[shader.id] = createColorResources({
          sharedBindings: this.environmentFamilies[1]?.bindings,
          ...this.scene,
          shader,
          environmentLayout: this.environmentLayout,
          shaderParameterBuffer: this.ensureParameterBuffer(),
        });
        if (this.hdrPrepared)
          this.hdrEnvironmentFamilies[shader.id] = createColorResources({
            sharedBindings: this.hdrEnvironmentFamilies[1]?.bindings,
            ...this.scene,
            shader,
            colorFormat: "rgba16float",
            environmentLayout: this.environmentLayout,
            shaderParameterBuffer: this.ensureParameterBuffer(),
          });
      }
    } catch (error) {
      failure = error;
    }
    const validation = await gpu.device.popErrorScope();
    if (failure || validation || gpu.lost || gpu.disposed) {
      delete this.families[shader.id];
      delete this.hdrFamilies[shader.id];
      delete this.environmentFamilies[shader.id];
      delete this.hdrEnvironmentFamilies[shader.id];
      throw (
        failure ?? new Error(validation?.message ?? "GPU device unavailable")
      );
    }
    materials.shaders.commit(shader);
    return shader.id;
  }
  /** Flushes changed parameter rows before draw encoding; no GPU objects are allocated here. */
  uploadParameters(): void {
    this.scene.materials.uploadShaderParameters(
      this.scene.gpu.queue,
      this.parameterBuffer,
    );
  }
}
