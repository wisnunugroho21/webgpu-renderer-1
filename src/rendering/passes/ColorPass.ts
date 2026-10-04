import { MaterialManager } from "../materials/MaterialManager";
import {
  MaterialShaderDefinition,
  RegisteredMaterialShader,
} from "../materials/MaterialShaderRegistry";
import { MeshManager } from "../MeshManager";
import {
  MATERIAL_PIPELINE_VARIANTS,
  DEPTH_READ_ONLY_OFFSET,
  INDIRECT_VERTEX_OFFSET,
} from "../pipelines/ColorPipelineLayout";
import { EnvironmentSkybox } from "../environment/EnvironmentSkybox";
import { HDRRendering } from "../post/HDRRendering";
import { EnvironmentLighting } from "../environment/EnvironmentLighting";
import {
  ColorResourcesInput,
  createColorResources,
  colorShaderSource,
} from "../pipelines/createColorResources";
import { GeometryOptimization } from "../geometry/GeometryOptimization";
import { BatchBuilder } from "../BatchBuilder";
import { DepthPrepass } from "../DepthPrepass";
import { RendererStats } from "../../profiling/RendererStats";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";

interface ColorPassScene extends ColorResourcesInput {
  readonly batches: BatchBuilder;
  readonly geometryOptimization: GeometryOptimization;
  readonly depthPrepass: DepthPrepass;
  readonly stats: RendererStats;
  readonly gpuProfiler: GPUProfiler;
  readonly meshes: MeshManager;
  readonly materials: MaterialManager;
}

/** Owns bounded color variants and optional presentation inputs.
 * Constructor/feature callbacks prepare GPU objects; encode only reuses them and submits batches. */
export class ColorPass {
  readonly base: ReturnType<typeof createColorResources>;
  readonly environment: EnvironmentLighting;
  readonly skybox: EnvironmentSkybox;
  readonly hdr: HDRRendering;
  private hdrColor?: ReturnType<typeof createColorResources>;
  private hdrEnvironmentColor?: ReturnType<typeof createColorResources>;
  private environmentColor?: ReturnType<typeof createColorResources>;
  private environmentLayout?: GPUBindGroupLayout;
  private parameterBuffer?: GPUBuffer;
  private readonly families: Array<ReturnType<typeof createColorResources>> =
    [];
  private readonly hdrFamilies: Array<ReturnType<typeof createColorResources>> =
    [];
  private readonly environmentFamilies: Array<
    ReturnType<typeof createColorResources>
  > = [];
  private readonly hdrEnvironmentFamilies: Array<
    ReturnType<typeof createColorResources>
  > = [];
  private registration: Promise<unknown> = Promise.resolve();
  /** Initializes bounded PBR pipeline variants and state-cached batch drawing. */
  constructor(private readonly scene: ColorPassScene) {
    this.base = createColorResources(this.scene);
    this.families[0] = this.base;
    for (const shader of this.scene.materials.shaders.definitions)
      this.prepareFamily(shader);
    this.hdr = new HDRRendering(this.scene.gpu, this.scene.resources, () => {
      // Prepares the bounded half-float color variants when HDR presentation is first requested.

      this.hdrColor ??= createColorResources({
        ...this.scene,
        colorFormat: "rgba16float",
      });
      this.prepareHDREnvironment();
      this.prepareHDRFamilies();
      this.prepareEnvironmentFamilies();
    });
    this.skybox = new EnvironmentSkybox(
      this.scene.gpu,
      this.scene.resources,
      () => /** Returns environment layout. */ this.environmentLayout,
    );
    this.environment = new EnvironmentLighting(
      this.scene.gpu.device,
      this.scene.resources,
      (environmentLayout) => {
        // Prepares shared environment color/skybox variants after an environment layout becomes available.

        this.environmentLayout = environmentLayout;
        if (this.skybox.enabled) this.skybox.prepare(environmentLayout);
        // Prepare retained HDR variants even when the feature is temporarily disabled.
        if (this.hdrColor) this.prepareHDREnvironment();
        this.environmentColor ??= createColorResources({
          ...this.scene,
          environmentLayout,
        });
        this.prepareEnvironmentFamilies();
      },
    );
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
    if (!this.hdrColor) return;
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
      if (this.hdrColor)
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
      if (this.hdrColor)
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
        if (this.hdrColor)
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
  /** Builds the bounded combined HDR/environment pipeline variants on the cold feature setup path. */
  private prepareHDREnvironment(): void {
    if (this.environmentLayout)
      this.hdrEnvironmentColor ??= createColorResources({
        ...this.scene,
        colorFormat: "rgba16float",
        environmentLayout: this.environmentLayout,
      });
  }

  /** Draws skybox and ordered batches into the direct/HDR target while caching pipeline, material and mesh bindings. */
  encode(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    depthView: GPUTextureView,
    instanceOffset: number,
    clearColor: GPUColor,
  ): void {
    const scene = this.scene;
    const pass = encoder.beginRenderPass({
      label: "Opaque cube",
      timestampWrites: scene.gpuProfiler.writes(GPUPass.color),
      colorAttachments: [
        {
          view: this.hdr.sceneEnabled ? this.hdr.view! : view,
          clearValue: clearColor,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: scene.depthPrepass.enabled ? "load" : "clear",
        depthStoreOp: "store",
      },
    });
    this.skybox.encode(
      pass,
      this.environment.group,
      this.hdr.sceneEnabled ? "rgba16float" : scene.gpu.renderFormat,
    );
    const environment = this.environment.active;
    const colors = this.hdr.sceneEnabled
      ? environment
        ? this.hdrEnvironmentColor!
        : this.hdrColor!
      : environment
        ? this.environmentColor!
        : undefined;
    const customFamilies = this.hdr.sceneEnabled
      ? environment
        ? this.hdrEnvironmentFamilies
        : this.hdrFamilies
      : environment
        ? this.environmentFamilies
        : this.families;
    const pipelines = colors?.pipelines ?? this.base.pipelines;
    const frameGroups = colors?.frameGroups ?? this.base.frameGroups;
    if (environment) pass.setBindGroup(2, this.environment.group!);
    pass.setBindGroup(0, frameGroups[scene.dynamic.frameSlot]!, [
      instanceOffset,
    ]);
    let previousFamily = 0;
    let previousPipeline = -1,
      previousMaterial = -1,
      previousMesh = -1;
    const batches = scene.gpuDraws.enabled
      ? scene.gpuDraws.batches
      : scene.batches;
    for (let i = 0; i < batches.count; i++) {
      const mesh = batches.mesh[i]!,
        material = batches.material[i]!,
        pipeline = batches.pipeline[i]!,
        count = batches.instanceCount[i]!;
      const geometry = scene.meshes.get(mesh);
      const family = Math.floor(pipeline / MATERIAL_PIPELINE_VARIANTS);
      const color = family ? customFamilies[family]! : undefined;
      if (family !== previousFamily) {
        pass.setBindGroup(
          0,
          color?.frameGroups[scene.dynamic.frameSlot] ??
            frameGroups[scene.dynamic.frameSlot]!,
          [instanceOffset],
        );
        previousFamily = family;
      }
      if (pipeline !== previousPipeline) {
        pass.setPipeline(
          (color?.pipelines ?? pipelines)[
            (pipeline % MATERIAL_PIPELINE_VARIANTS) +
              (scene.depthPrepass.enabled ? DEPTH_READ_ONLY_OFFSET : 0) +
              (scene.gpuDraws.enabled ? INDIRECT_VERTEX_OFFSET : 0)
          ]!,
        );
        previousPipeline = pipeline;
        scene.stats.pipelineSwitches++;
      }
      if (material !== previousMaterial) {
        previousMaterial = material;
        pass.setBindGroup(
          1,
          scene.textures.groups[material] ?? scene.textures.fallback,
        );
        scene.stats.materialSwitches++;
      }
      if (mesh !== previousMesh) {
        previousMesh = mesh;
        scene.stats.meshSwitches++;
        pass.setVertexBuffer(0, geometry.vertex);
        pass.setIndexBuffer(geometry.index, "uint32");
      }
      if (scene.gpuDraws.enabled) {
        pass.drawIndexedIndirect(scene.gpuDraws.arguments, i * 20);
        scene.stats.indirectDraws++;
      } else if (scene.geometryOptimization.clusterCount[i]) {
        const first = scene.geometryOptimization.firstCluster[i]!,
          count = scene.geometryOptimization.clusterCount[i]!;
        for (let c = first; c < first + count; c++)
          pass.drawIndexedIndirect(
            scene.geometryOptimization.arguments!,
            c * 20,
          );
        scene.stats.geometryClusterDraws += count;
        scene.stats.indirectDraws += count;
        scene.stats.drawCalls += count - 1;
      } else
        pass.drawIndexed(
          geometry.indexCount,
          count,
          0,
          0,
          batches.firstInstance[i]!,
        );
      scene.stats.drawCalls++;
      scene.stats.instances += count;
      if (geometry.topology === 0)
        scene.stats.triangles += (geometry.indexCount / 3) * count;
    }
    pass.end();
  }
}
