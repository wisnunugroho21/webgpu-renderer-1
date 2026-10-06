import type { Application } from "./Application";
import { CPUStage } from "../profiling/CPUProfiler";

/** Gameplay hooks have completed; deformation → transforms → palettes → bounds → extraction is fixed. */
export function prepareApplicationScene(app: Application, delta: number): void {
  // Bounds and extraction must follow deformation and world-transform updates.
  app.profiler.start(CPUStage.animation);
  app.particles.update(delta);
  app.animations.update(delta);
  if (app.renderer.hdr.autoExposure) app.renderer.hdr.frameDeltaSeconds = delta;
  app.profiler.end(CPUStage.animation);
  app.profiler.start(CPUStage.transforms);
  app.transformSystem.update(app.world.transforms);
  app.profiler.end(CPUStage.transforms);
  app.cameraSystem.update(app.world, app.renderer.camera);
  app.profiler.start(CPUStage.skeletons);
  app.skeletonSystem.update(app.world, app.skeletons);
  app.profiler.end(CPUStage.skeletons);
  app.profiler.start(CPUStage.animatedBounds);
  if (app.renderer)
    app.animatedBounds.update(
      app.world,
      app.renderer.meshes,
      app.skeletons,
      app.animations.morphPool,
    );
  app.profiler.end(CPUStage.animatedBounds);
  app.profiler.start(CPUStage.extraction);
  app.extractor.extract(
    app.world,
    app.renderWorld,
    app.skeletons,
    app.animations.morphPool,
  );
  app.profiler.end(CPUStage.extraction);
  app.renderer.stats.activeAnimators = app.animations.activeAnimators;
}

/** One command buffer carries every graph pass. Completion waits belong only to diagnostics/lifecycle work. */
export function submitApplicationFrame(app: Application): void {
  const encoder = app.gpu.device.createCommandEncoder({
    label: "Frame encoder",
  });
  app.renderer.encode(
    encoder,
    app.gpu.context
      .getCurrentTexture()
      .createView({ format: app.gpu.renderFormat }),
  );
  // Submit once after every graph pass has encoded into the same command buffer.
  app.gpu.queue.submit([encoder.finish()]);
}

/** Refreshes transforms, camera selection and extracted records after asset membership changes. */
export function refreshApplicationSnapshot(app: Application): void {
  app.transformSystem.update(app.world.transforms);
  if (app.renderer) app.cameraSystem.update(app.world, app.renderer.camera);
  app.extractor.extract(
    app.world,
    app.renderWorld,
    app.skeletons,
    app.animations.morphPool,
  );
}
