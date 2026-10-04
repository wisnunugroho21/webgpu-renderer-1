import { GPUContext } from "../gpu/GPUContext";
import { Renderer } from "../rendering/Renderer";
import { RenderWorld } from "../rendering/RenderWorld";
import { MaterialManager } from "../rendering/materials/MaterialManager";
import { CPUProfiler } from "../profiling/CPUProfiler";
import { ApplicationAssets } from "./ApplicationAssets";

interface DeviceRebuildInput {
  readonly gpu: GPUContext;
  readonly previous: Renderer;
  readonly canvas: HTMLCanvasElement;
  readonly world: RenderWorld;
  readonly materials: MaterialManager;
  readonly profiler: CPUProfiler;
  readonly assets: ApplicationAssets["loader"];
  /** Reports whether teardown prevents further resource publication. */
  isDisposing(): boolean;
  /** Handles device loss for the supplied context and schedules recovery when enabled. */
  onLost(gpu: GPUContext): void;
  /** Reports an uncaptured GPU failure and stops unsafe submission. */
  onError(message: string): void;
}

/** Prepare a replacement without publishing it. On failure, CPU provenance stays retryable.
 * Asset and streaming tasks settle before ownership changes; all work is outside the frame loop. */
export async function rebuildDeviceResources(input: DeviceRebuildInput) {
  const previous = input.previous;
  if (!previous) throw new Error("Application is not initialized");
  await input.assets.quiesce();
  await previous.streaming.quiesce();
  previous.meshes.assertRecoverable();
  input.gpu.dispose();
  let nextGPU: GPUContext | undefined, next: Renderer | undefined;
  try {
    nextGPU = await GPUContext.create(
      input.canvas,
      () =>
        /** Delegates this operation to input.onLost. */ input.onLost(nextGPU!),
      input.onError,
    );
    if (input.isDisposing())
      throw new Error("Application disposed during recovery");
    nextGPU.renderScale = input.gpu.renderScale;
    nextGPU.device.pushErrorScope("validation");
    next = new Renderer(
      nextGPU,
      input.world,
      input.materials,
      input.profiler,
      previous.camera,
    );
    previous.meshes.rebuildInto(next.meshes);
    const remap = await previous.textures.rebuildInto(next.textures);
    next.restoreSettings(previous);
    if (previous.environment.data)
      await next.setEnvironment(previous.environment.data);
    next.environment.enabled = previous.environment.enabled;
    next.environment.intensity = previous.environment.intensity;
    next.environment.rotationY = previous.environment.rotationY;
    const validation = await nextGPU.device.popErrorScope();
    if (validation) throw new Error(validation.message);
    if (input.isDisposing() || nextGPU.lost)
      throw new Error("Device unavailable during recovery");
    return { gpu: nextGPU, renderer: next, textureRemap: remap };
  } catch (error) {
    next?.dispose();
    nextGPU?.dispose();
    throw error;
  }
}
