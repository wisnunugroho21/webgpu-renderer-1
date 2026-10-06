import type { Renderer } from "./Renderer";
import { CPUStage } from "../profiling/CPUProfiler";

/** Prepares snapshot visibility and sorted batches; retained owners and scratch remain on Renderer. */
export class RendererVisibility {
  private bvhRevision = -1;
  /** Bind the current device renderer once; recovery constructs a new coordinator. */
  constructor(private readonly renderer: Renderer) {}
  /** Optional GPU paths enable their prerequisites before any visibility work. */
  configureDependencies(indirect: boolean): void {
    const renderer = this.renderer;
    if (renderer.gpuOcclusion.enabled) {
      renderer.gpuFrustum.enabled = true;
      renderer.hiz.enabled = true;
    }
    if (renderer.gpuCompaction.enabled) renderer.gpuFrustum.enabled = true;
    renderer.gpuDraws.enabled = indirect;
    if (indirect) {
      if (!renderer.gpuDraws.supported)
        throw new Error("GPU indirect mode requires indirect-first-instance");
      renderer.gpuFrustum.enabled =
        renderer.gpuCompaction.enabled =
        renderer.gpuLOD.enabled =
          true;
      for (let i = 0; i < renderer.world.count; i++)
        if (renderer.world.lodGroup[i]! >= 0)
          renderer.world.meshId[i] =
            renderer.lodGroups.entries[renderer.world.lodGroup[i]!]!.meshes[0]!;
    }
    renderer.depthPrepass.skipLOD = indirect;
    if (renderer.gpuLOD.enabled) renderer.gpuFrustum.enabled = true;
    if (
      renderer.hiz.enabled ||
      renderer.hiz.debugEnabled ||
      renderer.gpuOcclusion.enabled
    )
      renderer.depthPrepass.enabled = true;
  }

  /** CPU culling and LOD produce the queue input; indirect mode leaves selection to the GPU. */
  prepare(indirect: boolean, width: number, height: number): number {
    const renderer = this.renderer;
    renderer.camera.update(width / height);
    renderer.stats.reset();
    renderer.profiler.start(CPUStage.culling);
    renderer.frustum.setFromMatrix(renderer.camera.viewProjection);
    if (
      renderer.visibilityMode === "bvh" &&
      this.bvhRevision !== renderer.world.staticRevision
    ) {
      renderer.bvh.build(renderer.world);
      this.bvhRevision = renderer.world.staticRevision;
    }
    const frustumVisible =
      renderer.cullingEnabled && !indirect
        ? renderer.visibilityMode === "bvh"
          ? renderer.bvh.cull(renderer.world, renderer.frustum, renderer.culler)
          : renderer.culler.cull(renderer.world, renderer.frustum)
        : renderer.world.count;
    renderer.stats.totalRenderables = renderer.world.count;
    renderer.stats.frustumTested =
      renderer.cullingEnabled && !indirect
        ? renderer.visibilityMode === "bvh"
          ? renderer.bvh.objectsTested
          : renderer.world.count
        : 0;
    renderer.stats.bvhNodesTested =
      renderer.cullingEnabled && renderer.visibilityMode === "bvh"
        ? renderer.bvh.nodesTested
        : 0;
    const input =
      renderer.cullingEnabled && !indirect
        ? renderer.visibilityMode === "bvh"
          ? renderer.bvh.visible
          : renderer.culler.visible
        : undefined;
    const visible = indirect
      ? renderer.world.count
      : renderer.lodSelector.select(
          renderer.world,
          renderer.camera,
          renderer.gpu.canvas.height,
          input,
          frustumVisible,
        );
    renderer.stats.lod0 = renderer.lodSelector.distribution[0]!;
    renderer.stats.lod1 = renderer.lodSelector.distribution[1]!;
    renderer.stats.lod2 = renderer.lodSelector.distribution[2]!;
    renderer.stats.lodOther = 0;
    for (let level = 3; level < 8; level++)
      renderer.stats.lodOther += renderer.lodSelector.distribution[level]!;
    renderer.stats.lodCulled = renderer.lodSelector.culled;
    renderer.stats.visibleObjects = visible;
    renderer.stats.culledObjects = renderer.world.count - visible;
    renderer.stats.frustumRejected = renderer.world.count - frustumVisible;
    renderer.profiler.end(CPUStage.culling);
    return visible;
  }

  /** Sorting establishes stable pipeline/material/mesh runs before shared instance packing. */
  prepareBatches(indirect: boolean, visible: number): void {
    const renderer = this.renderer;
    renderer.profiler.start(CPUStage.sorting);
    renderer.queue.build(
      renderer.world,
      renderer.materials,
      renderer.camera.view,
      indirect ? undefined : renderer.lodSelector.visible,
      visible,
    );
    for (let i = 0; i < renderer.world.count; i++)
      renderer.queue.pipeline[i] = renderer.materials.colorPipelineIndex(
        renderer.world.materialId[i]!,
        renderer.meshes.get(renderer.world.meshId[i]!).topology,
      );
    renderer.sorter.lodAware = indirect;
    renderer.sorter.sort(
      renderer.queue,
      renderer.world,
      renderer.submissionMode !== "individual",
    );
    renderer.batches.build(
      renderer.queue,
      renderer.world,
      renderer.submissionMode === "instanced" || indirect,
      indirect,
    );
    renderer.profiler.end(CPUStage.sorting);
  }
}
