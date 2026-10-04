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
  get assetInstances() {
    return this.assets.instances;
  }
  get assetLoader() {
    return this.assets.loader;
  }
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

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly status: HTMLOutputElement,
    entityCapacity = 16384,
    renderCapacity = entityCapacity,
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
      renderer: () => this.renderer,
      gpu: () => this.gpu,
      isDisposing: () => this.disposing,
      checkDevice: () => this.checkLoadingDevice(),
      refreshSnapshot: () => this.refreshAssetSnapshot(),
    });
    this.sceneEntity = this.world.create();
    this.world.transforms.add(this.sceneEntity);
    this.world.meshes.set(this.sceneEntity, 0, 0);
    this.world.bounds.setSphere(this.sceneEntity, 0, 0, 0, Math.sqrt(3));
    this.materials.create();
    this.defaultLightEntity = this.world.create();
    this.world.transforms.add(this.defaultLightEntity);
    this.world.lights.set(this.defaultLightEntity, {
      type: "directional",
      intensity: 3,
      direction: [-0.4, -0.6, -1],
    });
  }

  onFixedUpdate(callback: FixedUpdate): () => void {
    return this.simulation.onFixedUpdate(callback);
  }
  onUpdate(callback: FrameUpdate): () => void {
    return this.simulation.onUpdate(callback);
  }
  setActiveCamera(entity: number | EntityHandle | null): void {
    this.cameraSystem.select(
      typeof entity === "object" && entity !== null
        ? this.world.require(entity)
        : entity,
      this.world,
    );
  }

  /** Pointer-event picking against the latest extracted bounds; never waits for the GPU. */
  pick(clientX: number, clientY: number): EntityHandle | null {
    return this.picking.pick(this.renderer?.camera, clientX, clientY);
  }

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
        this.starting = undefined;
      });
    return this.starting;
  }
  private async initialize(): Promise<void> {
    this.gpu = await GPUContext.create(
      this.canvas,
      (info) => {
        const resume = !this.stopped;
        this.stop();
        this.deviceState = "lost";
        this.status.textContent = `GPU device lost (${info.reason}): ${info.message}`;
        if (this.autoRecoverDevice && !this.disposing)
          void this.recoverDevice(resume).catch(() => {});
      },
      (message) => {
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
    );
    this.observer = new ResizeObserver(() => this.gpu.resize());
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
        this.deviceState = this.disposing ? "disposed" : "failed";
        this.status.textContent = `GPU recovery failed: ${String(error)}. Call recoverDevice() to retry.`;
        throw error;
      })
      .finally(() => {
        this.recovering = undefined;
      });
    return this.recovering;
  }
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
      isDisposing: () => this.disposing,
      onLost: (gpu) => {
        if (this.gpu === gpu && !this.disposing) {
          const resume = !this.stopped;
          this.stop();
          this.deviceState = "lost";
          if (this.autoRecoverDevice)
            void this.recoverDevice(resume).catch(() => {});
        }
      },
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

  pause(): void {
    this.stop();
  }
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
  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frameId);
    this.observer?.disconnect();
  }

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

  cancelAssetLoad(url: string): boolean {
    return this.assetLoader.cancel(url);
  }
  /** Removes every instance loaded through this application, then releases its cached asset. */
  unloadAsset(url: string): Promise<void> {
    if (this.recovering)
      return this.recovering.then(() => this.assetLoader.unload(url));
    return this.assetLoader.unload(url);
  }

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

  async dispose(): Promise<void> {
    this.stop();
    this.disposing = true;
    this.deviceState = "disposed";
    await this.recovering?.catch(() => {});
    this.environments.clear();
    this.simulation.clear();
    this.assetDecoder.dispose();
    try {
      await this.assetLoader.dispose();
    } finally {
      this.renderer?.dispose();
      this.gpu?.dispose();
    }
  }
}
