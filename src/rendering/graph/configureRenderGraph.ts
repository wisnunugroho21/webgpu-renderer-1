import { RenderGraph } from "./RenderGraph";
type Execute = (encoder: GPUCommandEncoder, view: GPUTextureView) => void;
interface RenderCallbacks {
  gpuFrustum: Execute;
  shadows: Execute;
  lightClusters: Execute;
  depth: Execute;
  geometryClusters: Execute;
  color: Execute;
  postProcessing: Execute;
  toneMapping: Execute;
  hiz: Execute;
  hizDebug: Execute;
  gpuOcclusion: Execute;
  gpuCompaction: Execute;
  gpuIndirect: Execute;
  gpuLod: Execute;
}
/** Resource names are versions: each output has one producer. Disabled callbacks are no-ops.
 * Keep pass dependencies here; compute/render implementations stay with their owners. */
export function configureRenderGraph(
  graph: RenderGraph<GPUTextureView>,
  callbacks: RenderCallbacks,
): void {
  graph.add({
    name: "gpu-frustum",
    reads: ["frame", "geometry"],
    writes: ["gpuVisibility"],
    execute: callbacks.gpuFrustum,
  });
  graph.add({
    name: "shadows",
    reads: [
      "geometry",
      "instances",
      "materials",
      "deformation",
      "lights",
      "frame",
    ],
    writes: ["shadowDepth"],
    execute: callbacks.shadows,
  });
  graph.add({
    name: "light-clusters",
    reads: ["lights", "frame"],
    writes: ["clusterMetadata", "clusterIndices"],
    execute: callbacks.lightClusters,
  });
  graph.add({
    name: "depth",
    reads: ["geometry", "materials", "instances", "deformation", "frame"],
    writes: ["prepassDepth"],
    execute: callbacks.depth,
  });
  graph.add({
    name: "geometry-clusters",
    reads: ["frame", "geometry", "instances"],
    writes: ["geometryArguments"],
    execute: callbacks.geometryClusters,
  });
  graph.add({
    name: "color",
    reads: [
      "geometry",
      "materials",
      "instances",
      "deformation",
      "lights",
      "frame",
      "drawArguments",
      "geometryArguments",
      "prepassDepth",
      "shadowDepth",
      "clusterMetadata",
      "clusterIndices",
    ],
    writes: ["mainDepth", "sceneColor"],
    execute: callbacks.color,
  });
  graph.add({
    name: "post-processing",
    reads: ["sceneColor"],
    writes: ["processedSceneColor"],
    execute: callbacks.postProcessing,
  });
  graph.add({
    name: "tone-mapping",
    reads: ["processedSceneColor"],
    writes: ["swapchain"],
    execute: callbacks.toneMapping,
  });
  graph.add({
    name: "hiz",
    reads: ["prepassDepth"],
    writes: ["hizDepth"],
    execute: callbacks.hiz,
  });
  graph.add({
    name: "hiz-debug",
    reads: ["hizDepth", "swapchain"],
    writes: ["finalSwapchain"],
    execute: callbacks.hizDebug,
  });
  graph.add({
    name: "gpu-occlusion",
    reads: ["gpuVisibility", "hizDepth", "frame", "geometry"],
    writes: ["gpuOcclusionVisibility"],
    execute: callbacks.gpuOcclusion,
  });
  graph.add({
    name: "gpu-compaction",
    reads: ["gpuLODVisibility"],
    writes: ["visibleInstances", "visibleCounter"],
    execute: callbacks.gpuCompaction,
  });
  graph.add({
    name: "gpu-indirect",
    reads: ["visibleInstances", "visibleCounter"],
    writes: ["drawArguments"],
    execute: callbacks.gpuIndirect,
  });
  graph.add({
    name: "gpu-lod",
    reads: ["gpuOcclusionVisibility", "frame", "geometry"],
    writes: ["gpuLODVisibility", "gpuLODSelections"],
    execute: callbacks.gpuLod,
  });
  graph.compile();
}
