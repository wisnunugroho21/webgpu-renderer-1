import { Resources } from "../gpu/Resources";
import { GPUProfiler, GPUPass } from "../profiling/GPUProfiler";
import { RendererStats } from "../profiling/RendererStats";
import { BatchBuilder } from "./BatchBuilder";
import { MeshManager } from "./MeshManager";
import { MaterialManager } from "./materials/MaterialManager";
import { MaterialTextures } from "./materials/MaterialTextures";
import { ShadowManager } from "./shadows/ShadowManager";
/** Camera depth reuses deformed geometry bindings/entry point and alpha-mask semantics. */
export class DepthPrepass {
  enabled = false;
  skipLOD = false;
  private readonly pipelines: GPURenderPipeline[];
  constructor(
    resources: Resources,
    private readonly geometry: ShadowManager,
    private readonly meshes: MeshManager,
    private readonly materials: MaterialManager,
    private readonly textures: MaterialTextures,
  ) {
    this.pipelines = geometry.descriptors.map((descriptor) =>
      resources.pipelines.get({
        ...descriptor,
        label: "Camera depth prepass",
        depthStencil: {
          ...descriptor.depthStencil!,
          format: "depth24plus",
          depthBias: 0,
          depthBiasSlopeScale: 0,
        },
      }),
    );
  }
  encode(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    slot: number,
    instanceOffset: number,
    batches: BatchBuilder,
    stats: RendererStats,
    profiler: GPUProfiler,
  ): void {
    if (!this.enabled) return;
    const pass = encoder.beginRenderPass({
      label: "Depth prepass",
      colorAttachments: [],
      timestampWrites: profiler.writes(GPUPass.depth),
      depthStencilAttachment: {
        view,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setBindGroup(0, this.geometry.groups[slot]!, [instanceOffset]);
    pass.setBindGroup(2, this.geometry.passGroups[slot]!, [0]);
    for (let i = 0; i < batches.count; i++) {
      const material = batches.material[i]!;
      if (
        this.materials.alphaMode[material] === 2 ||
        (this.skipLOD && batches.lodGroup[i]! >= 0)
      )
        continue;
      const mesh = this.meshes.get(batches.mesh[i]!),
        count = batches.instanceCount[i]!,
        pipeline = this.materials.doubleSided[material]! * 3 + mesh.topology;
      pass.setPipeline(this.pipelines[pipeline]!);
      pass.setBindGroup(
        1,
        this.textures.groups[material] ?? this.textures.fallback,
      );
      pass.setVertexBuffer(0, mesh.vertex);
      pass.setIndexBuffer(mesh.index, "uint32");
      pass.drawIndexed(mesh.indexCount, count, 0, 0, batches.firstInstance[i]!);
      stats.depthDrawCalls++;
      if (mesh.topology === 0)
        stats.depthTriangles += (mesh.indexCount / 3) * count;
    }
    pass.end();
    stats.depthPasses++;
  }
}
