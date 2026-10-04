import type { ColorResources } from "../pipelines/ColorResources";
import type { MaterialManager } from "../materials/MaterialManager";
import type { MaterialShaderDefinition } from "../materials/MaterialShaderRegistry";
import { CustomMaterialShaders } from "../materials/CustomMaterialShaders";
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
  private hdrColor?: ColorResources;
  private hdrEnvironmentColor?: ColorResources;
  private environmentColor?: ColorResources;
  private environmentLayout?: GPUBindGroupLayout;
  private readonly customShaders: CustomMaterialShaders;
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
