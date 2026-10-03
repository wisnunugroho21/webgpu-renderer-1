import { SimulationLoop, FixedUpdate, FrameUpdate } from "./SimulationLoop";
import { CameraSystem } from "../ecs/systems/CameraSystem";
import { AssetInstances } from "../assets/AssetInstances";
import { transferableBuffers } from "../assets/workers/transfer";
import { uploadAsset, releaseUploadedAsset } from "../assets/uploadAsset";
import { AssetDecoder } from "../assets/workers/AssetDecoder";
import { AssetLoader } from "../assets/AssetLoader";
import { GLTFLoader } from "../assets/gltf/GLTFLoader";
import { instantiate, UploadedAsset } from "../assets/gltf/instantiate";
import { RuntimeAsset } from "../assets/gltf/RuntimeAsset";
import { JSONDocument } from "@gltf-transform/core";
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
  readonly animations = new AnimationSystem();
  readonly skeletons = new SkeletonRegistry();
  readonly skeletonSystem = new SkeletonSystem();
  readonly animatedBounds = new AnimatedBoundsSystem();
  readonly simulation = new SimulationLoop();
  readonly cameraSystem = new CameraSystem();
  private starting?: Promise<void>;
  private lastFrameTime = 0;
  readonly transformSystem: TransformSystem;
  readonly sceneEntity: number;
  readonly defaultLightEntity: number;
  readonly renderWorld: RenderWorld;
  readonly extractor = new RenderExtractor();
  readonly materials = new MaterialManager();
  readonly profiler = new CPUProfiler();
  readonly assetInstances: AssetInstances;
  private disposing = false;
  readonly assetLoader = new AssetLoader<
    JSONDocument,
    RuntimeAsset,
    UploadedAsset
  >(
    (url, signal) => this.gltf.fetch(url, signal),
    (data, signal) => this.assetDecoder.decode(data, signal),
    (asset, signal) => this.uploadAsset(asset, signal),
    undefined,
    {
      decodedBytes: (asset) =>
        transferableBuffers(asset).reduce(
          (bytes, buffer) => bytes + buffer.byteLength,
          0,
        ),
      beforeUnload: (uploaded, asset, url) => {
        if (!this.disposing) this.assertCanUnloadAsset(url, uploaded);
        this.assetInstances.detach(url, asset);
        this.refreshAssetSnapshot();
      },
      release: (uploaded) =>
        releaseUploadedAsset(
          uploaded,
          this.renderer.meshes,
          this.materials,
          this.renderer.textures,
          () => this.gpu.queue.onSubmittedWorkDone(),
        ),
      canEvict: (record) => {
        if (!record.uploaded) return true;
        try {
          this.assertCanUnloadAsset(record.url, record.uploaded);
          return true;
        } catch {
          return false;
        }
      },
    },
  );
  private readonly gltf = new GLTFLoader();
  readonly assetDecoder = new AssetDecoder(this.gltf);
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
    this.assetInstances = new AssetInstances(
      this.world,
      this.animations,
      this.skeletons,
    );
    this.transformSystem = new TransformSystem(entityCapacity);
    this.renderWorld = new RenderWorld(renderCapacity);
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
  setActiveCamera(entity: number | null): void {
    this.cameraSystem.select(entity, this.world);
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
        this.stop();
        this.status.textContent = `GPU device lost (${info.reason}): ${info.message}. Reload to restart.`;
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
      // Bounds and extraction must follow deformation and world-transform updates.
      this.profiler.start(CPUStage.animation);
      this.animations.update(delta);
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
    if (this.disposing || !this.renderer || this.gpu.disposed || this.gpu.lost)
      throw new Error("Device unavailable during asset loading");
  }
  private async uploadAsset(
    asset: RuntimeAsset,
    signal: AbortSignal,
  ): Promise<UploadedAsset> {
    this.checkLoadingDevice();
    return uploadAsset(
      asset,
      this.renderer.meshes,
      this.materials,
      this.renderer.textures,
      () => {
        signal.throwIfAborted();
        this.checkLoadingDevice();
      },
    );
  }
  /** Each call creates a scene instance; cached GPU assets remain shared. */
  async loadAsset(url: string): Promise<Uint32Array> {
    this.checkLoadingDevice();
    const release = this.assetLoader.retain(url);
    try {
      const uploaded = await this.assetLoader.load(url);
      this.checkLoadingDevice();
      const record = this.assetLoader.records.get(url);
      if (
        !record?.decoded ||
        record.state !== "Ready" ||
        record.uploaded !== uploaded
      )
        throw new Error("Asset was unloaded before instantiation");
      const asset = record.decoded,
        start = this.world.nextEntity;
      try {
        const nodes = instantiate(
          asset,
          this.world,
          this.renderer.meshes,
          this.materials,
          asset.defaultScene,
          this.animations,
          this.skeletons,
          uploaded,
        );
        this.assetInstances.add(url, start, this.world.nextEntity, release);
        return nodes;
      } catch (error) {
        this.assetInstances.rollback(start, asset);
        throw error;
      }
    } catch (error) {
      release();
      throw error;
    }
  }

  cancelAssetLoad(url: string): boolean {
    return this.assetLoader.cancel(url);
  }
  /** Removes every instance loaded through this application, then releases its cached asset. */
  unloadAsset(url: string): Promise<void> {
    return this.assetLoader.unload(url);
  }

  private assertCanUnloadAsset(url: string, uploaded: UploadedAsset): void {
    this.assetInstances.assertCanUnload(url, uploaded);
    const ids = new Set(uploaded.meshIds.flat());
    for (const group of this.renderer.lodGroups.entries)
      if (group.meshes.some((id) => ids.has(id)))
        throw new Error(
          "Asset is referenced by an LOD group; detach it before unloading",
        );
    if (this.renderer.streaming.referencesAsset(uploaded))
      throw new Error(
        "Asset is referenced by streaming; detach it before unloading",
      );
    const materialIds = new Set(uploaded.materialIds);
    for (let id = 0; id < this.renderer.textures.groups.length; id++)
      if (
        !materialIds.has(id) &&
        uploaded.textureGroups?.includes(this.renderer.textures.groups[id]!)
      )
        throw new Error("Asset texture group is bound to an external material");
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
