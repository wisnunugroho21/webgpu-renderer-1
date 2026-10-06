import type { Renderer } from "./Renderer";
import type { ColorPass } from "./passes/ColorPass";
import { CPUStage } from "../profiling/CPUProfiler";
import { FrameUniforms } from "./FrameUniforms";
import {
  FRAME_BYTES,
  MATRIX_BYTES,
  MATRIX_WORDS,
  INSTANCE_BYTES,
  INSTANCE_WORDS,
} from "./layouts";

/** Owns frame numbering, uniform scratch and upload ordering; graph dispatch stays in Renderer. */
export class RendererUploads {
  frameNumber = 0;
  instanceOffset = 0;
  private readonly uniforms = new FrameUniforms();
  /** Retain setup owners once instead of constructing a per-frame dependency object. */
  constructor(
    private readonly renderer: Renderer,
    private readonly colorPass: ColorPass,
  ) {}
  /** Reuse arena slots and persistent staging arrays. No GPU objects are created here. */
  upload(indirect: boolean, width: number, height: number): void {
    const renderer = this.renderer;
    renderer.profiler.start(CPUStage.encoding);
    renderer.environment.flush(renderer.skybox.enabled);
    renderer.skybox.update(renderer.camera);
    renderer.gpuProfiler.beginFrame(this.frameNumber);
    renderer.dynamic.beginFrame(this.frameNumber++);
    const clustered = renderer.clusters.choose(renderer.world);
    this.uniforms.update(
      renderer.camera,
      renderer.world.lightCount,
      renderer.clusters,
      clustered,
      width,
      height,
    );
    renderer.dynamic.write(
      renderer.dynamic.allocate(FRAME_BYTES),
      this.uniforms.data,
    );
    renderer.dynamic.write(
      renderer.dynamic.allocate(
        Math.max(MATRIX_BYTES, renderer.world.count * MATRIX_BYTES),
      ),
      renderer.world.matrices.subarray(
        0,
        Math.max(MATRIX_WORDS, renderer.world.count * MATRIX_WORDS),
      ),
    );
    renderer.instances.update(renderer.queue, renderer.world, renderer.meshes);
    const instanceOffset = renderer.dynamic.allocate(
      Math.max(INSTANCE_BYTES, renderer.queue.count * INSTANCE_BYTES),
      renderer.gpu.device.limits.minStorageBufferOffsetAlignment,
    );
    renderer.dynamic.write(
      instanceOffset,
      renderer.instances.data.subarray(
        0,
        Math.max(INSTANCE_WORDS, renderer.queue.count * INSTANCE_WORDS),
      ),
    );
    renderer.shadows.prepare(
      renderer.world,
      renderer.camera,
      renderer.gpu.queue,
      renderer.stats,
    );
    renderer.dynamic.flush(renderer.gpu.queue);
    renderer.materials.upload(renderer.gpu.queue, renderer.materialBuffer);
    this.colorPass.uploadParameters();
    renderer.joints.upload(renderer.gpu.queue, renderer.world);
    renderer.morphWeights.upload(renderer.gpu.queue, renderer.world);
    renderer.lights.upload(renderer.gpu.queue, renderer.world);
    this.prepareGPUPaths(indirect, width, height);
    this.recordUploadStats(clustered);
    this.instanceOffset = instanceOffset;
  }

  /** Prepare optional compute inputs after all shared frame writes; the graph performs actual dispatches. */
  private prepareGPUPaths(
    indirect: boolean,
    width: number,
    height: number,
  ): void {
    const renderer = this.renderer;
    renderer.gpuFrustum.update(renderer.world, renderer.gpu.queue);
    const temporalEnabled = renderer.temporal.enabled;
    if (!renderer.gpuOcclusion.enabled) renderer.temporal.enabled = false;
    renderer.temporal.prepare(
      renderer.world,
      renderer.camera,
      renderer.materials.revision,
      width,
      height,
      indirect,
    );
    renderer.temporal.enabled = temporalEnabled;
    renderer.gpuLOD.prepare(renderer.world, renderer.gpu.queue);
    renderer.gpuDraws.prepare(
      renderer.world,
      renderer.queue,
      renderer.batches,
      renderer.meshes,
      renderer.materials,
      renderer.gpu.queue,
    );
    renderer.geometryOptimization.prepare(
      renderer.batches,
      renderer.queue,
      renderer.world,
      renderer.meshes,
      renderer.camera.viewProjection,
      renderer.cullingEnabled,
      indirect,
      renderer.gpu.queue,
    );
  }

  /** Report bytes from their owners without changing dirty-range decisions or upload ordering. */
  private recordUploadStats(clustered: boolean): void {
    const renderer = this.renderer;
    renderer.stats.geometryClusterCandidates =
      renderer.geometryOptimization.count;
    renderer.stats.geometryFallbackBatches =
      renderer.geometryOptimization.fallbackBatches;
    renderer.stats.geometryUploadBytes =
      renderer.geometryOptimization.uploadBytes;
    renderer.stats.indirectUploadBytes = renderer.gpuDraws.uploadBytes;
    renderer.stats.gpuCandidates = renderer.gpuFrustum.enabled
      ? renderer.gpuFrustum.count
      : 0;
    renderer.stats.gpuObjectUploadBytes = renderer.gpuFrustum.uploadBytes;
    renderer.stats.lights = renderer.world.lightCount;
    renderer.stats.lightUploadBytes = renderer.lights.uploadBytes;
    renderer.stats.morphUploadBytes = renderer.morphWeights.uploadBytes;
    renderer.stats.activeMorphStates = renderer.world.activeMorphStates;
    renderer.stats.activeMorphTargets = renderer.world.activeMorphTargets;
    renderer.stats.morphTargets = renderer.world.morphTargets;
    renderer.stats.activeSkeletons = renderer.world.activeSkeletons;
    renderer.stats.jointCount = renderer.world.activeJoints;
    renderer.stats.updatedJoints = renderer.joints.updatedJoints;
    renderer.stats.jointUploadBytes = renderer.joints.uploadBytes;
    renderer.stats.bufferUploadBytes =
      renderer.dynamic.uploadBytes +
      renderer.materials.uploadBytes +
      renderer.materials.shaderUploadBytes +
      renderer.joints.uploadBytes +
      renderer.morphWeights.uploadBytes +
      renderer.lights.uploadBytes +
      renderer.stats.shadowUploadBytes +
      renderer.gpuFrustum.uploadBytes +
      renderer.gpuDraws.uploadBytes +
      renderer.gpuLOD.uploadBytes +
      renderer.geometryOptimization.uploadBytes;

    renderer.stats.clusters = clustered
      ? renderer.clusters.tilesX *
        renderer.clusters.tilesY *
        renderer.clusters.slices
      : 0;
  }
}
