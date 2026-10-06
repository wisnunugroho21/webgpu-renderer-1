import type { Renderer } from "./Renderer";

/** Replay CPU controls onto a fully constructed replacement device.
 * Setter order matters: configure exposure/AA before enabling HDR so cold target
 * preparation sees the restored controls. Never copy old-device GPU identities. */
export function copyRendererSettings(
  target: Renderer,
  previous: Renderer,
): void {
  target.camera.copyFrom(previous.camera);
  Object.assign(target.clearColor, previous.clearColor);
  target.submissionMode = previous.submissionMode;
  target.cullingEnabled = previous.cullingEnabled;
  target.visibilityMode = previous.visibilityMode;
  target.lodGroups.entries.push(...previous.lodGroups.entries);
  target.clusters.mode = previous.clusters.mode;
  target.shadows.budget.configure(previous.shadows.budget.options);
  target.shadows.budget.enabled = previous.shadows.budget.enabled;
  target.shadows.enabled = previous.shadows.enabled;
  target.shadows.cacheEnabled = previous.shadows.cacheEnabled;
  target.shadows.cullingEnabled = previous.shadows.cullingEnabled;
  target.shadows.cascades = previous.shadows.cascades;
  target.shadows.shadowDistance = previous.shadows.shadowDistance;
  target.depthPrepass.enabled = previous.depthPrepass.enabled;
  target.hiz.enabled = previous.hiz.enabled;
  target.hiz.debugEnabled = previous.hiz.debugEnabled;
  target.hiz.debugMip = previous.hiz.debugMip;
  target.gpuFrustum.enabled = previous.gpuFrustum.enabled;
  target.gpuOcclusion.enabled = previous.gpuOcclusion.enabled;
  target.gpuCompaction.enabled = previous.gpuCompaction.enabled;
  target.gpuLOD.enabled = previous.gpuLOD.enabled;
  target.temporal.enabled = previous.temporal.enabled;
  target.geometryOptimization.enabled = previous.geometryOptimization.enabled;
  target.gpuProfiler.enabled = previous.gpuProfiler.enabled;
  target.skybox.enabled = previous.skybox.enabled;
  target.hdr.exposure = previous.hdr.exposure;
  target.hdr.toneMapping = previous.hdr.toneMapping;
  target.hdr.bloomThreshold = previous.hdr.bloomThreshold;
  target.hdr.bloomStrength = previous.hdr.bloomStrength;
  target.hdr.exposureKey = previous.hdr.exposureKey;
  target.hdr.adaptationSpeed = previous.hdr.adaptationSpeed;
  target.hdr.autoExposure = previous.hdr.autoExposure;
  target.taa.feedback = previous.taa.feedback;
  target.taa.depthTolerance = previous.taa.depthTolerance;
  target.taa.jitter = previous.taa.jitter;
  target.antialiasing = previous.antialiasing;
  target.hdr.enabled = previous.hdr.enabled;
  target.transmission.enabled = previous.transmission.enabled;
}
