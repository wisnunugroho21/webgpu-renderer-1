import { MeshManager } from "../MeshManager";
import {
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
  constructor(private readonly scene: ColorPassScene) {
    this.base = createColorResources(this.scene);
    this.hdr = new HDRRendering(this.scene.gpu, this.scene.resources, () => {
      this.hdrColor ??= createColorResources({
        ...this.scene,
        colorFormat: "rgba16float",
      });
      this.prepareHDREnvironment();
    });
    this.skybox = new EnvironmentSkybox(
      this.scene.gpu,
      this.scene.resources,
      () => this.environmentLayout,
    );
    this.environment = new EnvironmentLighting(
      this.scene.gpu.device,
      this.scene.resources,
      (environmentLayout) => {
        this.environmentLayout = environmentLayout;
        if (this.skybox.enabled) this.skybox.prepare(environmentLayout);
        // Prepare retained HDR variants even when the feature is temporarily disabled.
        if (this.hdrColor) this.prepareHDREnvironment();
        this.environmentColor ??= createColorResources({
          ...this.scene,
          environmentLayout,
        });
      },
    );
  }

  private prepareHDREnvironment(): void {
    if (this.environmentLayout)
      this.hdrEnvironmentColor ??= createColorResources({
        ...this.scene,
        colorFormat: "rgba16float",
        environmentLayout: this.environmentLayout,
      });
  }

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
          view: this.hdr.enabled ? this.hdr.view! : view,
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
      this.hdr.enabled ? "rgba16float" : scene.gpu.renderFormat,
    );
    const environment = this.environment.active;
    const colors = this.hdr.enabled
      ? environment
        ? this.hdrEnvironmentColor!
        : this.hdrColor!
      : environment
        ? this.environmentColor!
        : undefined;
    const pipelines = colors?.pipelines ?? this.base.pipelines;
    const frameGroups = colors?.frameGroups ?? this.base.frameGroups;
    if (environment) pass.setBindGroup(2, this.environment.group!);
    pass.setBindGroup(0, frameGroups[scene.dynamic.frameSlot]!, [
      instanceOffset,
    ]);
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
      if (pipeline !== previousPipeline) {
        pass.setPipeline(
          pipelines[
            pipeline +
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
