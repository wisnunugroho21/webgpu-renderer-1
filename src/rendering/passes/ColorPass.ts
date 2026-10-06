import { TransmissionRendering } from "../post/TransmissionRendering";
import { halfFloatClearColor } from "../post/halfFloatClearColor";
import { createColorFrameGroups } from "../pipelines/createColorBindings";
import type { UnifiedTransparency } from "../UnifiedTransparency";
import type { ParticleRenderer } from "../particles/ParticleRenderer";
import type { ColorResources } from "../pipelines/ColorResources";
import type { MaterialManager } from "../materials/MaterialManager";
import type { MaterialShaderDefinition } from "../materials/MaterialShaderRegistry";
import { CustomMaterialShaders } from "../materials/CustomMaterialShaders";
import { MeshManager } from "../MeshManager";
import {
  MATERIAL_PIPELINE_VARIANTS,
  BLEND_PIPELINE_OFFSET,
  DEPTH_READ_ONLY_OFFSET,
  INDIRECT_VERTEX_OFFSET,
} from "../pipelines/ColorPipelineLayout";
import { EnvironmentSkybox } from "../environment/EnvironmentSkybox";
import { HDRRendering } from "../post/HDRRendering";
import { EnvironmentLighting } from "../environment/EnvironmentLighting";
import {
  ColorResourcesInput,
  createColorResources,
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
  readonly base: ColorResources;
  readonly environment: EnvironmentLighting;
  readonly skybox: EnvironmentSkybox;
  readonly hdr: HDRRendering;
  readonly transmission: TransmissionRendering;
  private transmissionColor?: ColorResources;
  private transmissionEnvironmentColor?: ColorResources;
  private hdrColor?: ColorResources;
  private hdrEnvironmentColor?: ColorResources;
  private environmentColor?: ColorResources;
  private environmentLayout?: GPUBindGroupLayout;
  private readonly customShaders: CustomMaterialShaders;
  private readonly linearClear = [0, 0, 0, 1];
  /** Initializes bounded PBR pipeline variants and state-cached batch drawing. */
  constructor(private readonly scene: ColorPassScene) {
    this.base = createColorResources(this.scene);
    this.customShaders = new CustomMaterialShaders(this.scene, this.base);
    this.hdr = new HDRRendering(this.scene.gpu, this.scene.resources, () => {
      // Prepares the bounded half-float color variants when HDR presentation is first requested.

      this.hdrColor ??= createColorResources({
        ...this.scene,
        colorFormat: "rgba16float",
      });
      this.prepareHDREnvironment();
      this.customShaders.prepareHDR();
    });
    this.transmission = new TransmissionRendering(
      this.scene.resources,
      this.hdr,
      this.scene.textures.mipmaps,
      () => {
        // Feature setup and capture resize refresh bounded color variants before frame encoding.
        this.prepareTransmission();
      },
    );
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
        if (this.transmission.enabled) this.prepareTransmission();
        if (this.skybox.enabled) this.skybox.prepare(environmentLayout);
        // Prepare retained HDR variants even when the feature is temporarily disabled.
        if (this.hdrColor) this.prepareHDREnvironment();
        this.environmentColor ??= createColorResources({
          ...this.scene,
          environmentLayout,
        });
        this.customShaders.prepareEnvironment(environmentLayout);
      },
    );
  }

  /** Registers a cold shader transaction through its dedicated resource owner. */
  registerShader(definition: MaterialShaderDefinition): Promise<number> {
    return this.customShaders.registerShader(definition);
  }
  /** Flushes shared custom parameters before the graph consumes them. */
  uploadParameters(): void {
    this.customShaders.uploadParameters();
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

  /** Prepare/rebind linear transmission families without changing pipeline identities on capture resize. */
  private prepareTransmission(): void {
    const transmission = this.transmission.inputs!;
    this.transmissionColor ??= createColorResources({
      ...this.scene,
      colorFormat: "rgba16float",
      transmission,
    });
    if (this.environmentLayout)
      this.transmissionEnvironmentColor ??= createColorResources({
        ...this.scene,
        colorFormat: "rgba16float",
        environmentLayout: this.environmentLayout,
        transmission,
      });
    for (const color of [
      this.transmissionColor,
      this.transmissionEnvironmentColor,
    ])
      if (color) {
        const groups = createColorFrameGroups(
          { ...this.scene, transmission },
          color.pipeline.getBindGroupLayout(0),
        );
        color.frameGroups.splice(0, color.frameGroups.length, ...groups);
      }
    this.customShaders.prepareTransmission(transmission);
  }
  /** Draw opaque/masked batches, or a shared alpha schedule with read-only depth and restored mesh state. */
  encode(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    depthView: GPUTextureView,
    instanceOffset: number,
    clearColor: GPUColor,
    schedule?: UnifiedTransparency,
    particles?: ParticleRenderer,
  ): void {
    const scene = this.scene;
    const pass = encoder.beginRenderPass({
      label: schedule ? "Unified transparency" : "Opaque cube",
      timestampWrites: scene.gpuProfiler.writes(
        schedule ? GPUPass.transparency : GPUPass.color,
      ),
      colorAttachments: [
        {
          view: this.hdr.sceneEnabled ? this.hdr.view! : view,
          clearValue: this.hdr.sceneEnabled
            ? halfFloatClearColor(clearColor, this.linearClear)
            : clearColor,
          loadOp: schedule ? "load" : "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: schedule
        ? { view: depthView, depthReadOnly: true }
        : {
            view: depthView,
            depthClearValue: 1,
            depthLoadOp: scene.depthPrepass.enabled ? "load" : "clear",
            depthStoreOp: "store",
          },
    });
    if (!schedule)
      this.skybox.encode(
        pass,
        this.environment.group,
        this.hdr.sceneEnabled ? "rgba16float" : scene.gpu.renderFormat,
      );
    const environment = this.environment.active;
    const colors = this.transmission.enabled
      ? environment
        ? this.transmissionEnvironmentColor!
        : this.transmissionColor!
      : this.hdr.sceneEnabled
        ? environment
          ? this.hdrEnvironmentColor!
          : this.hdrColor!
        : environment
          ? this.environmentColor!
          : undefined;
    const customFamilies = this.transmission.enabled
      ? environment
        ? this.customShaders.transmissionEnvironmentFamilies
        : this.customShaders.transmissionFamilies
      : this.hdr.sceneEnabled
        ? environment
          ? this.customShaders.hdrEnvironmentFamilies
          : this.customShaders.hdrFamilies
        : environment
          ? this.customShaders.environmentFamilies
          : this.customShaders.families;
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
    for (
      let run = 0;
      run < (schedule ? schedule.count : batches.count);
      run++
    ) {
      if (schedule && schedule.kind[run] !== 0) {
        particles!.drawRange(
          pass,
          this.hdr.sceneEnabled,
          schedule.kind[run] === 2,
          schedule.first[run]!,
          schedule.length[run]!,
        );
        // Effect pipelines replace group zero; restore every mesh binding after crossing a stream boundary.
        previousFamily =
          previousPipeline =
          previousMaterial =
          previousMesh =
            -1;
        continue;
      }
      const i = schedule ? schedule.batch[run]! : run;
      if (
        !schedule &&
        batches.pipeline[i]! % MATERIAL_PIPELINE_VARIANTS >=
          BLEND_PIPELINE_OFFSET
      )
        continue;
      const slice = schedule ? schedule.first[run]! : 0;
      const mesh = batches.mesh[i]!,
        material = batches.material[i]!,
        pipeline = batches.pipeline[i]!,
        count = schedule ? schedule.length[run]! : batches.instanceCount[i]!;
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
        if (environment) pass.setBindGroup(2, this.environment.group!);
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
          batches.firstInstance[i]! + slice,
        );
      scene.stats.drawCalls++;
      scene.stats.instances += count;
      if (geometry.topology === 0)
        scene.stats.triangles += (geometry.indexCount / 3) * count;
    }
    if (schedule) particles!.drawAdditive(pass, this.hdr.sceneEnabled);
    pass.end();
  }
}
