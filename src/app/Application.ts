import { ParticleSystem } from "../particles/ParticleSystem";
import { createDefaultScene } from "./createDefaultScene";
import { ApplicationPicking } from "./ApplicationPicking";
import { SpatialQueries } from "../spatial/SpatialQueries";
import { rebuildDeviceResources } from "./rebuildDeviceResources";
import { ApplicationAssets, AssetInstance } from "./ApplicationAssets";
import { EnvironmentLoader } from "../rendering/environment/EnvironmentLoader";
import { EnvironmentBakeOptions } from "../rendering/environment/bakeEnvironment";
import { EntityHandle } from "../ecs/Entity";
import { SimulationLoop, FixedUpdate, FrameUpdate } from "./SimulationLoop";
import { CameraSystem } from "../ecs/systems/CameraSystem";
import { GLTFLoader } from "../assets/gltf/GLTFLoader";
import { CPUProfiler, CPUStage } from "../profiling/CPUProfiler";
import { AnimatedBoundsSystem } from "../ecs/systems/AnimatedBoundsSystem";
import { SkeletonSystem } from "../ecs/systems/SkeletonSystem";
import { SkeletonRegistry } from "../animation/skinning/SkeletonRegistry";
import { AnimationSystem } from "../ecs/systems/AnimationSystem";
import { GPUContext } from "../gpu/GPUContext";
import { Renderer } from "../rendering/Renderer";
import { World } from "../ecs/World";
import { TransformSystem } from "../ecs/systems/TransformSystem";
import { RenderWorld } from "../rendering/RenderWorld";
import { RenderExtractor } from "../rendering/RenderExtractor";
import { MaterialManager } from "../rendering/materials/MaterialManager";

/** Owns browser lifecycle and simulation order; the renderer consumes only the extracted snapshot. */
export class Application {
  gpu!: GPUContext;
  renderer!: Renderer;
  readonly world: World;
  readonly environments = new EnvironmentLoader();
  readonly animations = new AnimationSystem();
  readonly skeletons = new SkeletonRegistry();
  readonly skeletonSystem = new SkeletonSystem();
  readonly animatedBounds = new AnimatedBoundsSystem();
  readonly simulation = new SimulationLoop();
  readonly cameraSystem = new CameraSystem();
  private starting?: Promise<void>;
  private recovering?: Promise<void>;
  autoRecoverDevice = true;
  deviceState: "ready" | "lost" | "recovering" | "failed" | "disposed" =
    "ready";
  private lastFrameTime = 0;
  readonly transformSystem: TransformSystem;
  readonly sceneEntity: number;
  readonly defaultLightEntity: number;
  readonly renderWorld: RenderWorld;
  readonly spatial: SpatialQueries;
  private readonly picking: ApplicationPicking;
  readonly extractor = new RenderExtractor();
  readonly materials = new MaterialManager();
  readonly profiler = new CPUProfiler();
  private readonly assets: ApplicationAssets;
  /** Returns the scene-instance registry used to track imported entity and animator ownership. */
  get assetInstances() {
    return this.assets.instances;
  }
  /** Returns the shared asset cache/loader for explicit retention, cancellation and diagnostics. */
  get assetLoader() {
    return this.assets.loader;
  }
  /** Returns the worker-backed decoder used by cold asset-loading operations. */
  get assetDecoder() {
    return this.assets.decoder;
  }
  private disposing = false;
  private readonly gltf = new GLTFLoader();
  frames = 0;
  readonly encodingTimes = new Float64Array(600);
  private frameId = 0;
  private stopped = false;
  private observer?: ResizeObserver;
  private pixelRatio = window.devicePixelRatio;

  /** Initializes the browser application, gameplay world and render snapshot. */
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly status: HTMLOutputElement,
    entityCapacity = 16384,
    renderCapacity = entityCapacity,
    readonly particles = new ParticleSystem(),
  ) {
    this.world = new World(entityCapacity);
    this.transformSystem = new TransformSystem(entityCapacity);
    this.renderWorld = new RenderWorld(renderCapacity);
    this.spatial = new SpatialQueries(this.renderWorld);
    this.picking = new ApplicationPicking(canvas, this.world, this.spatial);
    this.assets = new ApplicationAssets({
      world: this.world,
      animations: this.animations,
      skeletons: this.skeletons,
      materials: this.materials,
      gltf: this.gltf,
      /** Returns the current renderer owner so callers follow device-recovery replacements. */
      renderer: () => this.renderer,
      /** Returns the current GPU context used for validated resource publication. */
      gpu: () => this.gpu,
      /** Reports whether application teardown prevents further asset publication. */
      isDisposing: () => this.disposing,
      /** Checks that the current device can accept asset publication. */
      checkDevice: () => this.checkLoadingDevice(),
      /** Refreshes render membership after asset instantiation or removal. */
      refreshSnapshot: () => this.refreshAssetSnapshot(),
    });
    const defaults = createDefaultScene(this.world, this.materials);
    this.sceneEntity = defaults.sceneEntity;
    this.defaultLightEntity = defaults.defaultLightEntity;
  }

  /** Registers a fixed-step gameplay callback and returns its unsubscribe function. */
  onFixedUpdate(callback: FixedUpdate): () => void {
    return this.simulation.onFixedUpdate(callback);
  }
  /** Registers a variable-frame callback with interpolation alpha before animation and extraction. */
  onUpdate(callback: FrameUpdate): () => void {
    return this.simulation.onUpdate(callback);
  }
  /** Selects an ECS camera, validating handle identity; null returns control to the renderer camera. */
  setActiveCamera(entity: number | EntityHandle | null): void {
    this.cameraSystem.select(
      typeof entity === "object" && entity !== null
        ? this.world.require(entity)
        : entity,
      this.world,
    );
  }

  /** Installs validated custom surface shading before assigning its returned family ID to materials. */
  async registerMaterialShader(
    definition: import("../rendering/materials/MaterialShaderRegistry").MaterialShaderDefinition,
  ): Promise<number> {
    this.checkLoadingDevice();
    return this.renderer.registerMaterialShader(definition);
  }

  /** Pointer-event picking against the latest extracted bounds; never waits for the GPU. */
  pick(clientX: number, clientY: number): EntityHandle | null {
    return this.picking.pick(this.renderer?.camera, clientX, clientY);
  }

  /** Initializes GPU resources once or resumes the existing application; concurrent starts share one promise. */
  start(): Promise<void> {
    if (this.disposing)
      return Promise.reject(new Error("Application disposed"));
    if (this.renderer) {
      try {
        this.resume();
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    }
    if (!this.starting)
      this.starting = this.initialize().finally(() => {
        // Clears the settled startup promise so later start calls can resume or retry.

        this.starting = undefined;
      });
    return this.starting;
  }
  /** Creates the device and renderer, extracts the initial scene, installs resize handling and schedules rendering. */
  private async initialize(): Promise<void> {
    this.gpu = await GPUContext.create(
      this.canvas,
      (info) => {
        // Stops on device loss and optionally rebuilds resources before resuming the previous loop state.

        const resume = !this.stopped;
        this.stop();
        this.deviceState = "lost";
        this.status.textContent = `GPU device lost (${info.reason}): ${info.message}`;
        if (this.autoRecoverDevice && !this.disposing)
          void this.recoverDevice(resume).catch(() => {
            // Intentionally performs no work at this optional callback boundary.
          });
      },
      (message) => {
        // Stops rendering and reports the uncaptured GPU error in the status output.

        this.stop();
        this.status.textContent = `WebGPU error: ${message}`;
      },
    );
    if (this.disposing) {
      this.gpu.dispose();
      throw new Error("Application disposed during startup");
    }
    this.stopped = false;
    this.lastFrameTime = 0;
    this.simulation.resetAccumulator();
    this.transformSystem.update(this.world.transforms);
    this.skeletonSystem.update(this.world, this.skeletons);
    if (this.renderer)
      this.animatedBounds.update(
        this.world,
        this.renderer.meshes,
        this.skeletons,
        this.animations.morphPool,
      );
    this.extractor.extract(
      this.world,
      this.renderWorld,
      this.skeletons,
      this.animations.morphPool,
    );
    this.renderer = new Renderer(
      this.gpu,
      this.renderWorld,
      this.materials,
      this.profiler,
      undefined,
      this.particles,
    );
    this.observer = new ResizeObserver(() =>
      /** Delegates this operation to this.gpu.resize. */ this.gpu.resize(),
    );
    this.observer.observe(this.canvas);
    this.status.textContent = "WebGPU ready • indexed cube";
    this.frameId = requestAnimationFrame(this.frame);
  }

  /** Single cold recovery operation. ECS identities, playback, materials and shared assets survive. */
  recoverDevice(resumeAfter = !this.stopped): Promise<void> {
    if (this.disposing)
      return Promise.reject(new Error("Application disposed"));
    if (this.recovering) return this.recovering;
    this.stop();
    this.deviceState = "recovering";
    this.status.textContent = "Recovering GPU device…";
    this.recovering = this.rebuildDevice(resumeAfter)
      .catch((error) => {
        // Handles asynchronous failure so application can report or retire the failed operation.

        this.deviceState = this.disposing ? "disposed" : "failed";
        this.status.textContent = `GPU recovery failed: ${String(error)}. Call recoverDevice() to retry.`;
        throw error;
      })
      .finally(() => {
        // Clears the settled recovery promise so another device loss can start a new recovery.

        this.recovering = undefined;
      });
    return this.recovering;
  }
  /** Recreates GPU owners from retained CPU definitions and publishes them only after successful recovery. */
  private async rebuildDevice(resumeAfter: boolean): Promise<void> {
    const previous = this.renderer;
    const replacement = await rebuildDeviceResources({
      gpu: this.gpu,
      previous,
      canvas: this.canvas,
      world: this.renderWorld,
      materials: this.materials,
      profiler: this.profiler,
      assets: this.assetLoader,
      /** Reports whether application teardown prevents further asset publication. */
      isDisposing: () => this.disposing,
      /** Stops submission on device loss and starts automatic recovery when configured. */
      onLost: (gpu) => {
        if (this.gpu === gpu && !this.disposing) {
          const resume = !this.stopped;
          this.stop();
          this.deviceState = "lost";
          if (this.autoRecoverDevice)
            void this.recoverDevice(resume).catch(() => {
              // Intentionally performs no work at this optional callback boundary.
            });
        }
      },
      /** Stops rendering and reports an uncaptured GPU error through application status. */
      onError: (message) => {
        this.stop();
        this.status.textContent = `WebGPU error: ${message}`;
      },
    });
    try {
      // Preparation resolves asynchronously; disposal/loss may happen before this continuation.
      if (this.disposing || replacement.gpu.lost)
        throw new Error("Device unavailable during recovery");
      // Publish only after validation. Existing lease identities move together with streaming.
      for (const record of this.assetLoader.records.values())
        if (record.uploaded?.textureGroups)
          record.uploaded.textureGroups = replacement.textureRemap.get(
            record.uploaded.textureGroups,
          )!;
      replacement.renderer.restoreStreaming(previous, replacement.textureRemap);
      this.gpu = replacement.gpu;
      this.renderer = replacement.renderer;
      this.renderWorld.jointDirty.fill(1);
      this.renderWorld.morphDirty.fill(1);
      this.renderWorld.lightDirty.fill(1);
      previous.dispose();
      this.deviceState = "ready";
      this.status.textContent = "GPU recovered";
      this.lastFrameTime = 0;
      this.simulation.resetAccumulator();
      if (resumeAfter) this.resume();
    } catch (error) {
      replacement.renderer.dispose();
      replacement.gpu.dispose();
      throw error;
    }
  }

  /** Gameplay hooks have completed; deformation → transforms → palettes → bounds → extraction is fixed. */
  private prepareScene(delta: number): void {
    // Bounds and extraction must follow deformation and world-transform updates.
    this.profiler.start(CPUStage.animation);
    this.particles.update(delta);
    this.animations.update(delta);
    if (this.renderer.hdr.autoExposure)
      this.renderer.hdr.frameDeltaSeconds = delta;
    this.profiler.end(CPUStage.animation);
    this.profiler.start(CPUStage.transforms);
    this.transformSystem.update(this.world.transforms);
    this.profiler.end(CPUStage.transforms);
    this.cameraSystem.update(this.world, this.renderer.camera);
    this.profiler.start(CPUStage.skeletons);
    this.skeletonSystem.update(this.world, this.skeletons);
    this.profiler.end(CPUStage.skeletons);
    this.profiler.start(CPUStage.animatedBounds);
    if (this.renderer)
      this.animatedBounds.update(
        this.world,
        this.renderer.meshes,
        this.skeletons,
        this.animations.morphPool,
      );
    this.profiler.end(CPUStage.animatedBounds);
    this.profiler.start(CPUStage.extraction);
    this.extractor.extract(
      this.world,
      this.renderWorld,
      this.skeletons,
      this.animations.morphPool,
    );
    this.profiler.end(CPUStage.extraction);
    this.renderer.stats.activeAnimators = this.animations.activeAnimators;
  }

  /** One command buffer carries every graph pass. Completion waits belong only to diagnostics/lifecycle work. */
  private submitFrame(): void {
    const encoder = this.gpu.device.createCommandEncoder({
      label: "Frame encoder",
    });
    this.renderer.encode(
      encoder,
      this.gpu.context
        .getCurrentTexture()
        .createView({ format: this.gpu.renderFormat }),
    );
    // Submit once after every graph pass has encoded into the same command buffer.
    this.gpu.queue.submit([encoder.finish()]);
  }

  /** Advances bounded gameplay, prepares the current pose, submits one frame and schedules the next RAF callback. */
  private readonly frame = (timestamp: number): void => {
    if (this.stopped || this.gpu.lost) return;
    if (this.pixelRatio !== window.devicePixelRatio) {
      this.pixelRatio = window.devicePixelRatio;
      this.gpu.resize();
    }
    try {
      const start = performance.now();
      this.profiler.beginFrame();
      const rawDelta = this.lastFrameTime
        ? Math.max(0, (timestamp - this.lastFrameTime) / 1000)
        : 0;
      this.lastFrameTime = timestamp;
      this.profiler.start(CPUStage.simulation);
      const delta = this.simulation.advance(rawDelta);
      this.profiler.end(CPUStage.simulation);
      this.prepareScene(delta);
      this.submitFrame();
      this.renderer.stats.frameTimeMs = rawDelta * 1000;
      this.renderer.stats.fps = rawDelta > 0 ? 1 / rawDelta : 0;
      this.renderer.stats.cpuFrameMs = performance.now() - start;
      this.encodingTimes[this.frames % this.encodingTimes.length] =
        this.renderer.stats.cpuFrameMs;
      this.profiler.finishFrame();
      this.frames++;
      if (!this.stopped) this.frameId = requestAnimationFrame(this.frame);
    } catch (error) {
      this.stop();
      this.status.textContent = `Frame update failed: ${String(error)}`;
      console.error(error);
    }
  };

  /** Stops frame scheduling through the shared stop path. */
  pause(): void {
    this.stop();
  }
  /** Resets elapsed-time accumulation and schedules rendering after a pause when the device is usable. */
  resume(): void {
    this.checkLoadingDevice();
    if (!this.stopped) return;
    this.stopped = false;
    this.lastFrameTime = 0;
    this.simulation.resetAccumulator();
    this.gpu.resize();
    this.observer?.observe(this.canvas);
    this.frameId = requestAnimationFrame(this.frame);
  }
  /** Cancels the pending animation frame and disconnects resize observation. */
  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frameId);
    this.observer?.disconnect();
  }

  /** Rejects asset/environment work while disposal, device loss or recovery makes GPU publication unsafe. */
  private checkLoadingDevice(): void {
    if (
      this.disposing ||
      this.deviceState === "recovering" ||
      !this.renderer ||
      this.gpu.disposed ||
      this.gpu.lost
    )
      throw new Error("Device unavailable during asset loading");
  }
  /** Each call creates an independent scene instance from shared GPU assets. */
  loadAsset(url: string): Promise<Uint32Array> {
    return this.assets.loadAsset(url);
  }
  /** Recyclable handles preserve identity across entity-slot reuse. */
  loadAssetHandles(url: string): Promise<readonly EntityHandle[]> {
    return this.assets.loadAssetHandles(url);
  }

  /** Despawn one scene while retaining shared GPU assets for surviving instances. */
  instantiateAsset(url: string): Promise<AssetInstance> {
    return this.assets.instantiateAsset(url);
  }

  /** Loads and prepares linear HDR environment data, then installs it only on the still-current device. */
  async loadEnvironment(
    url: string,
    options: EnvironmentBakeOptions = {},
    signal?: AbortSignal,
  ): Promise<void> {
    this.checkLoadingDevice();
    const renderer = this.renderer,
      data = await this.environments.load(url, options, signal);
    signal?.throwIfAborted();
    this.checkLoadingDevice();
    if (renderer !== this.renderer)
      throw new Error("Device changed during environment loading");
    await renderer.setEnvironment(data);
  }

  /** Cancels a pending load for the canonical URL without removing already published scenes. */
  cancelAssetLoad(url: string): boolean {
    return this.assetLoader.cancel(url);
  }
  /** Removes every instance loaded through this application, then releases its cached asset. */
  unloadAsset(url: string): Promise<void> {
    if (this.recovering)
      return this.recovering.then(() =>
        /** Continues application after the preceding asynchronous operation succeeds. */ this.assetLoader.unload(
          url,
        ),
      );
    return this.assetLoader.unload(url);
  }

  /** Refreshes transforms, camera selection and extracted records after asset membership changes. */
  private refreshAssetSnapshot(): void {
    this.transformSystem.update(this.world.transforms);
    if (this.renderer)
      this.cameraSystem.update(this.world, this.renderer.camera);
    this.extractor.extract(
      this.world,
      this.renderWorld,
      this.skeletons,
      this.animations.morphPool,
    );
  }

  /** Stops callbacks and loading, awaits pending recovery, then releases environment, asset, renderer and device owners. */
  async dispose(): Promise<void> {
    this.stop();
    this.disposing = true;
    this.deviceState = "disposed";
    await this.recovering?.catch(() => {
      // Intentionally performs no work at this optional callback boundary.
    });
    this.environments.clear();
    this.simulation.clear();
    this.particles.dispose();
    this.assetDecoder.dispose();
    try {
      await this.assetLoader.dispose();
    } finally {
      this.renderer?.dispose();
      this.gpu?.dispose();
    }
  }
}
