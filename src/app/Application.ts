import { EnvironmentLoader } from "../rendering/environment/EnvironmentLoader";
import { EnvironmentBakeOptions } from "../rendering/environment/bakeEnvironment";
import { EntityHandle } from "../ecs/Entity";
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
  setActiveCamera(entity: number | EntityHandle | null): void {
    this.cameraSystem.select(
      typeof entity === "object" && entity !== null
        ? this.world.require(entity)
        : entity,
      this.world,
    );
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
    const previous = this.renderer,
      oldGPU = this.gpu;
    if (!previous) throw new Error("Application is not initialized");
    await this.assetLoader.quiesce();
    await previous.streaming.quiesce();
    previous.meshes.assertRecoverable();
    oldGPU.dispose();
    let nextGPU: GPUContext | undefined, next: Renderer | undefined;
    try {
      nextGPU = await GPUContext.create(
        this.canvas,
        () => {
          if (this.gpu === nextGPU && !this.disposing) {
            const resume = !this.stopped;
            this.stop();
            this.deviceState = "lost";
            if (this.autoRecoverDevice)
              void this.recoverDevice(resume).catch(() => {});
          }
        },
        (message) => {
          this.stop();
          this.status.textContent = `WebGPU error: ${message}`;
        },
      );
      if (this.disposing)
        throw new Error("Application disposed during recovery");
      nextGPU.device.pushErrorScope("validation");
      next = new Renderer(
        nextGPU,
        this.renderWorld,
        this.materials,
        this.profiler,
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
      if (this.disposing || nextGPU.lost)
        throw new Error("Device unavailable during recovery");
      // Commit only after every GPU resource has rebuilt. Old CPU ownership remains on failures.
      for (const record of this.assetLoader.records.values())
        if (record.uploaded?.textureGroups)
          record.uploaded.textureGroups = remap.get(
            record.uploaded.textureGroups,
          )!;
      next.restoreStreaming(previous, remap);
      this.gpu = nextGPU;
      this.renderer = next;
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
      next?.dispose();
      nextGPU?.dispose();
      throw error;
    }
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
    if (
      this.disposing ||
      this.deviceState === "recovering" ||
      !this.renderer ||
      this.gpu.disposed ||
      this.gpu.lost
    )
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
    return (await this.loadAssetInstance(url, false)).nodes;
  }
  /** Opt-in recyclable entities. Retain handles; resolve indices only for immediate SoA access. */
  async loadAssetHandles(url: string): Promise<readonly EntityHandle[]> {
    return (await this.loadAssetInstance(url, true)).handles;
  }
  private async loadAssetInstance(
    url: string,
    recycle: boolean,
  ): Promise<{ nodes: Uint32Array; handles: readonly EntityHandle[] }> {
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
        allocated: EntityHandle[] = [],
        handles = new Map<number, EntityHandle>();
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
          {
            available: recycle
              ? this.world.availableHandleSlots
              : this.world.capacity - this.world.nextEntity,
            create: () => {
              const handle = recycle
                ? this.world.createHandle()
                : this.world.handle(this.world.create());
              allocated.push(handle);
              handles.set(handle.index, handle);
              return handle.index;
            },
          },
        );
        this.assetInstances.addEntities(url, allocated, release);
        return {
          nodes,
          handles: Object.freeze(
            Array.from(nodes, (index) => handles.get(index)!),
          ),
        };
      } catch (error) {
        this.assetInstances.rollbackEntities(allocated, asset);
        throw error;
      }
    } catch (error) {
      release();
      throw error;
    }
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
