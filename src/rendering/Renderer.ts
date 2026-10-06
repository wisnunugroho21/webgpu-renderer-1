import type { TransmissionRendering } from "./post/TransmissionRendering";
import { shadowTargetOptions } from "./shadows/ShadowBudget";
import type { RendererOptions } from "./RendererOptions";
export type { RendererOptions } from "./RendererOptions";
import type { UnifiedTransparency } from "./UnifiedTransparency";
import { retainedMemory } from "../assets/retainedMemory";
import { copyRendererSettings } from "./copyRendererSettings";
import { ParticleSystem } from "../particles/ParticleSystem";
import { ParticleRenderer } from "./particles/ParticleRenderer";
import { createRendererResources } from "./createRendererResources";
import { ColorPass } from "./passes/ColorPass";
import { EnvironmentSkybox } from "./environment/EnvironmentSkybox";
import { TemporalAntialiasing } from "./post/TemporalAntialiasing";
import { HDRRendering } from "./post/HDRRendering";
import { EnvironmentData } from "./environment/EnvironmentData";
import { EnvironmentLighting } from "./environment/EnvironmentLighting";
import { RendererUploads } from "./RendererUploads";
import { RendererVisibility } from "./RendererVisibility";
import { MATERIAL_WORDS } from "./layouts";
import { configureRenderGraph } from "./graph/configureRenderGraph";
import { GeometryOptimization } from "./geometry/GeometryOptimization";
import { RendererStreaming } from "./RendererStreaming";
import { TemporalVisibility } from "./visibility/TemporalVisibility";
import { GPULODSelector } from "./lod/GPULODSelector";
import { IndirectDraws } from "./visibility/IndirectDraws";
import { VisibilityCompactor } from "./visibility/VisibilityCompactor";
import { GPUOcclusionCuller } from "./visibility/GPUOcclusionCuller";
import { GPUFrustumCuller } from "./visibility/GPUFrustumCuller";
import { HiZPyramid } from "./visibility/HiZPyramid";
import { DepthPrepass } from "./DepthPrepass";
import { CPUProfiler, CPUStage } from "../profiling/CPUProfiler";
import { GPUProfiler } from "../profiling/GPUProfiler";
import { RenderGraph } from "./graph/RenderGraph";
import { ShadowManager } from "./shadows/ShadowManager";
import { ClusteredLighting } from "./lighting/ClusteredLighting";
import { LightBuffer } from "./LightBuffer";
import { LODGroups } from "./lod/LODGroups";
import { LODSelector } from "./lod/LODSelector";
import { MorphDeltaBuffers } from "./MorphDeltaBuffers";
import { MorphWeightBuffer } from "./MorphWeightBuffer";
import { JointMatrixBuffer } from "./JointMatrixBuffer";
import { GPUContext } from "../gpu/GPUContext";
import { Camera } from "./Camera";
import { Resources } from "../gpu/Resources";
import { DynamicBufferAllocator } from "../gpu/DynamicBufferAllocator";
import { RenderWorld } from "./RenderWorld";
import { MaterialManager } from "./materials/MaterialManager";
import { RenderQueue } from "./RenderQueue";
import { RenderSorter } from "./RenderSorter";
import { RendererStats } from "../profiling/RendererStats";
import { BatchBuilder } from "./BatchBuilder";
import { InstanceManager } from "./InstanceManager";
import { Frustum } from "../math/Frustum";
import { FrustumCuller } from "../visibility/FrustumCuller";
import { BVH } from "../visibility/BVH";
import { MeshManager } from "./MeshManager";

import { MaterialTextures } from "./materials/MaterialTextures";

/** Snapshot-only frame coordinator. Pass owners prepare resources; encode reuses shared frame state. */
export class Renderer {
  readonly particleRenderer: ParticleRenderer;
  readonly transparency: UnifiedTransparency;
  readonly environment: EnvironmentLighting;
  readonly skybox: EnvironmentSkybox;
  readonly hdr: HDRRendering;
  readonly taa: TemporalAntialiasing;
  readonly transmission: TransmissionRendering;
  /** Returns the presentation anti-aliasing mode owned by the HDR/presentation subsystem. */
  get antialiasing(): "none" | "fxaa" | "taa" {
    return this.hdr.antialiasing;
  }
  /** Selects presentation anti-aliasing and lets its owner prepare any required targets. */
  set antialiasing(value: "none" | "fxaa" | "taa") {
    if (value === "taa") this.taa.preflight();
    this.hdr.antialiasing = value;
    this.taa.enabled = value === "taa";
    this.taa.resize(this.hdr.sceneTexture, this.depthView);
  }
  private readonly colorPass: ColorPass;
  readonly geometryOptimization: GeometryOptimization;
  readonly camera: Camera;
  readonly lodGroups = new LODGroups();
  readonly lodSelector: LODSelector;
  readonly queue: RenderQueue;
  readonly sorter = new RenderSorter();
  readonly stats = new RendererStats();
  readonly batches: BatchBuilder;
  readonly instances: InstanceManager;
  submissionMode: "individual" | "sorted" | "instanced" | "gpu-indirect" =
    "instanced";
  cullingEnabled = true;
  readonly frustum = new Frustum();
  readonly culler: FrustumCuller;
  readonly bvh: BVH;
  readonly meshes: MeshManager;
  streaming: RendererStreaming;
  private ownsStreaming = true;
  visibilityMode: "linear" | "bvh" = "linear";
  readonly resources: Resources;
  readonly dynamic: DynamicBufferAllocator;
  readonly materialBuffer: GPUBuffer;
  readonly textures: MaterialTextures;
  readonly joints: JointMatrixBuffer;
  readonly morphDeltas: MorphDeltaBuffers;
  readonly morphWeights: MorphWeightBuffer;
  readonly lights: LightBuffer;
  readonly clusters: ClusteredLighting;
  readonly shadows: ShadowManager;
  readonly depthPrepass: DepthPrepass;
  readonly hiz: HiZPyramid;
  readonly gpuFrustum: GPUFrustumCuller;
  readonly gpuOcclusion: GPUOcclusionCuller;
  readonly gpuCompaction: VisibilityCompactor;
  readonly gpuDraws: IndirectDraws;
  readonly gpuLOD: GPULODSelector;
  readonly temporal: TemporalVisibility;
  readonly previousVisibility: GPUBuffer;
  readonly gpuProfiler: GPUProfiler;
  readonly graph = new RenderGraph<GPUTextureView>([
    "frame",
    "geometry",
    "materials",
    "instances",
    "lights",
    "deformation",
  ]);
  private readonly uploads: RendererUploads;
  private readonly visibility: RendererVisibility;
  readonly pipelines: readonly GPURenderPipeline[];
  /** Share the upload coordinator clock with streaming/recovery callbacks. */
  private get frameNumber(): number {
    return this.uploads.frameNumber;
  }
  readonly frameBuffer: GPUBuffer;
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  readonly pipeline: GPURenderPipeline;
  readonly pipelineDescriptor: GPURenderPipelineDescriptor;
  readonly frameGroup: GPUBindGroup;
  private depth?: GPUTexture;
  private depthView?: GPUTextureView;
  private width = 0;
  private height = 0;
  readonly clearColor: GPUColor = {
    r: 0.00309598,
    g: 0.00719441,
    b: 0.0173891,
    a: 1,
  };

  /** Cold diagnostic snapshot: GPU logical storage and unique retained recovery payloads, never called per frame. */
  get memory() {
    const stats = this.resources.stats;
    return {
      gpuBytes: stats.gpuBytes,
      bufferBytes: stats.bufferBytes,
      textureBytes: stats.textureBytes,
      mipBytes: stats.textureMipBytes,
      compressedBytes: stats.compressedTextureBytes,
      renderTargetBytes: stats.renderTargetBytes,
      recoveryBytes: retainedMemory(this.recoverySources()),
    };
  }
  /** Gather CPU definitions shared with asset caches; application totals deduplicate their backing stores. */
  recoverySources(): unknown[] {
    return [
      this.meshes.recoverySources(),
      this.textures.recoverySources(),
      this.environment.data,
      this.particles.records,
      this.particles.curves.records,
      this.particles.atlas,
      this.particles.trails.recoverySources(),
      this.materials,
    ];
  }
  /** Initializes frame visibility, batching, shared uploads and graph execution. */
  constructor(
    readonly gpu: GPUContext,
    readonly world: RenderWorld,
    readonly materials: MaterialManager,
    readonly profiler = new CPUProfiler(),
    camera?: Camera,
    readonly particles = new ParticleSystem(),
    options: RendererOptions = {},
  ) {
    const shadowOptions = shadowTargetOptions(options.shadows);
    if (
      shadowOptions.resolution > gpu.device.limits.maxTextureDimension2D ||
      shadowOptions.layers > gpu.device.limits.maxTextureArrayLayers
    )
      throw new Error("Shadow target exceeds device limits");
    this.camera = camera ?? new Camera();
    const shared = createRendererResources(
      gpu,
      world,
      materials,
      this.lodGroups,
      shadowOptions,
    );
    this.resources = shared.resources;
    this.temporal = shared.temporal;
    this.previousVisibility = shared.previousVisibility;
    this.gpuProfiler = shared.gpuProfiler;
    this.hiz = shared.hiz;
    this.lights = shared.lights;
    this.joints = shared.joints;
    this.textures = shared.textures;
    this.morphDeltas = shared.morphDeltas;
    this.morphWeights = shared.morphWeights;
    this.meshes = shared.meshes;
    this.vertexBuffer = shared.vertexBuffer;
    this.indexBuffer = shared.indexBuffer;
    this.dynamic = shared.dynamic;
    this.frameBuffer = shared.frameBuffer;
    this.gpuFrustum = shared.gpuFrustum;
    this.gpuOcclusion = shared.gpuOcclusion;
    this.gpuCompaction = shared.gpuCompaction;
    this.gpuLOD = shared.gpuLOD;
    this.gpuDraws = shared.gpuDraws;
    this.clusters = shared.clusters;
    this.materialBuffer = shared.materialBuffer;
    this.shadows = shared.shadows;
    this.depthPrepass = shared.depthPrepass;
    this.geometryOptimization = shared.geometryOptimization;
    this.streaming = new RendererStreaming(
      gpu.queue,
      this.meshes,
      this.lodGroups,
      this.textures,
      materials,
      () =>
        /** Returns the current frame stamp for safe retirement and temporal resource tracking. */ this
          .frameNumber,
      world,
      () => {
        /* Cold streaming admission includes fixed pools, targets and retained provenance. */ return this
          .memory;
      },
    );
    this.queue = new RenderQueue(world.capacity);
    this.lodSelector = new LODSelector(world.capacity, this.lodGroups);
    this.culler = new FrustumCuller(world.capacity);
    this.bvh = new BVH(world.capacity);
    this.instances = new InstanceManager(world.capacity);
    this.batches = new BatchBuilder(world.capacity);

    this.colorPass = new ColorPass({
      gpu,
      world,
      resources: this.resources,
      dynamic: this.dynamic,
      materialBuffer: this.materialBuffer,
      materials,
      textures: this.textures,
      joints: this.joints,
      morphWeights: this.morphWeights,
      morphDeltas: this.morphDeltas,
      lights: this.lights,
      clusters: this.clusters,
      shadows: this.shadows,
      gpuDraws: this.gpuDraws,
      batches: this.batches,
      geometryOptimization: this.geometryOptimization,
      depthPrepass: this.depthPrepass,
      stats: this.stats,
      gpuProfiler: this.gpuProfiler,
      meshes: this.meshes,
    });
    this.environment = this.colorPass.environment;
    this.skybox = this.colorPass.skybox;
    this.hdr = this.colorPass.hdr;
    this.taa = new TemporalAntialiasing(this);
    this.transmission = this.colorPass.transmission;
    const color = this.colorPass.base;
    this.pipelineDescriptor = color.pipelineDescriptor;
    this.pipeline = color.pipeline;
    this.pipelines = color.pipelines;
    this.frameGroup = color.frameGroups[0]!;
    this.particleRenderer = new ParticleRenderer(
      gpu,
      this.resources,
      particles,
      world.capacity,
      this.textures.mipmaps,
    );
    this.transparency = this.particleRenderer.transparency;
    this.uploads = new RendererUploads(this, this.colorPass);
    this.visibility = new RendererVisibility(this);
    this.configurePasses();
    this.resize();
  }

  /** Compile persistent callbacks after every pass owner exists. Encoding follows graph dependencies. */
  private configurePasses(): void {
    configureRenderGraph(this.graph, {
      /** Test snapshot bounds against the camera using this frame's shared arena slot. */
      gpuFrustum: (encoder) =>
        this.gpuFrustum.encode(
          encoder,
          this.dynamic.frameSlot,
          this.gpuProfiler,
        ),
      /** Draw only invalidated directional shadow layers with current deformation data. */
      shadows: (encoder) =>
        this.shadows.encode(encoder, this.world, this.stats, this.gpuProfiler),
      /** Build screen-space light lists before the color pass consumes them. */
      lightClusters: (encoder) =>
        this.clusters.encode(encoder, this.dynamic.frameSlot, this.gpuProfiler),
      /** Populate the main depth target with the same pose and alpha coverage as color. */
      depth: (encoder) =>
        this.depthPrepass.encode(
          encoder,
          this.depthView!,
          this.dynamic.frameSlot,
          this.uploads.instanceOffset,
          this.batches,
          this.stats,
          this.gpuProfiler,
        ),
      /** Cull prepared geometry clusters before color selects indirect cluster draws. */
      geometryClusters: (encoder) =>
        this.geometryOptimization.encode(
          encoder,
          this.dynamic.frameSlot,
          this.uploads.instanceOffset,
          this.gpuProfiler,
        ),
      /** Draw the sorted scene into the current direct or linear scene target. */
      color: (encoder, view) =>
        this.colorPass.encode(
          encoder,
          view,
          this.depthView!,
          this.uploads.instanceOffset,
          this.clearColor,
        ),
      /** Merge all alpha streams after opaque depth is final, then composite additive effects. */
      particles: (encoder, view) => {
        this.particleRenderer.prepareFrame(this.camera);
        this.transparency.build(
          this.queue,
          this.gpuDraws.enabled ? this.gpuDraws.batches : this.batches,
          this.particleRenderer,
        );
        if (
          !this.transparency.count &&
          !this.particleRenderer.billboardCount &&
          !this.particleRenderer.ribbonCount
        )
          return;
        this.colorPass.encode(
          encoder,
          view,
          this.depthView!,
          this.uploads.instanceOffset,
          this.clearColor,
          this.transparency,
          this.particleRenderer,
        );
      },
      /** Raster shared previous/current poses after opaque depth and before transparent composition. */
      motion: (encoder) => this.taa.encodeMotion(encoder),
      /** Capture opaque radiance and prepare roughness mips before transmitting transparent surfaces. */
      transmission: (encoder) =>
        this.transmission.encode(encoder, this.transmissionNeeded()),
      /** Resolve transparent-reactive temporal history before post effects consume scene radiance. */
      temporalResolve: (encoder) => this.taa.encodeResolve(encoder),
      /** Apply bloom/exposure to scene color after particle composition. */
      postProcessing: (encoder) => this.hdr.encodeEffects(encoder),
      /** Map/filter linear scene color into the final presentation attachment. */
      toneMapping: (encoder, view) =>
        this.hdr.encode(encoder, view, this.gpuProfiler),
      /** Builds the depth pyramid consumed by occlusion tests after the depth pass. */
      hiz: (encoder) => {
        if (!this.temporal.reuse) this.hiz.encode(encoder, this.gpuProfiler);
        else this.hiz.passes = 0;
      },
      /** Overlay the selected depth-pyramid mip when diagnostic display is enabled. */
      hizDebug: (encoder, view) => this.hiz.debug(encoder, view),
      /** Reuses prior visibility when temporally valid; otherwise tests current objects against the depth pyramid. */
      gpuOcclusion: (encoder) => {
        this.gpuOcclusion.dispatches = 0;
        if (this.gpuOcclusion.enabled) {
          const bytes = this.gpuFrustum.count * 4;
          if (this.temporal.reuse && bytes)
            encoder.copyBufferToBuffer(
              this.previousVisibility,
              0,
              this.gpuFrustum.visibility,
              0,
              bytes,
            );
          else if (!this.temporal.newObjects)
            this.gpuOcclusion.encode(
              encoder,
              this.dynamic.frameSlot,
              this.gpuProfiler,
            );
          if (this.temporal.enabled && bytes)
            encoder.copyBufferToBuffer(
              this.gpuFrustum.visibility,
              0,
              this.previousVisibility,
              0,
              bytes,
            );
        }
      },
      /** Compact surviving object indices for subsequent GPU draw preparation. */
      gpuCompaction: (encoder) =>
        this.gpuCompaction.encode(encoder, this.gpuProfiler),
      /** Generate indirect arguments from compacted visibility before color submission. */
      gpuIndirect: (encoder) => this.gpuDraws.encode(encoder, this.gpuProfiler),
      /** Resolve per-object mesh levels before indirect arguments are generated. */
      gpuLod: (encoder) =>
        this.gpuLOD.encode(encoder, this.dynamic.frameSlot, this.gpuProfiler),
    });
  }

  /** Cold device recovery: preserve CPU controls, never transfer old-device GPU objects. */
  restoreSettings(previous: Renderer): void {
    this.uploads.frameNumber = previous.frameNumber;
    copyRendererSettings(this, previous);
  }
  /** Rebinds resident streaming ownership to recovered GPU owners while retaining its CPU records. */
  restoreStreaming(
    previous: Renderer,
    remap: Map<GPUBindGroup[], GPUBindGroup[]>,
  ): void {
    this.streaming.quality.dispose();
    previous.ownsStreaming = false;
    previous.streaming.rebind(
      this.gpu.queue,
      this.meshes,
      this.lodGroups,
      this.textures,
      remap,
      () =>
        /** Returns the current frame stamp for safe retirement and temporal resource tracking. */ this
          .frameNumber,
      () => {
        /* Budget diagnostics follow the newly recovered resource owners. */ return this
          .memory;
      },
    );
    this.streaming = previous.streaming;
  }

  /** Recreates only size-dependent render targets when physical canvas dimensions change. */
  resize(): void {
    const { width, height } = this.gpu.canvas;
    this.hdr.resize(width, height);
    this.transmission.resize(this.hdr.sceneTexture);
    if (width === this.width && height === this.height) {
      this.taa.resize(this.hdr.sceneTexture, this.depthView);
      return;
    }
    if (this.depth) this.resources.textures.destroy(this.depth);
    this.width = width;
    this.height = height;
    this.clusters.resize(width, height);
    this.depth = this.resources.textures.create({
      label: "Main depth",
      size: [width, height],
      format: "depth24plus",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.depthView = this.depth.createView();
    this.particleRenderer.setDepth(this.depthView);
    this.hiz.resize(width, height, this.depthView);
    this.gpuOcclusion.resize(this.hiz.texture!);
    this.taa.resize(this.hdr.sceneTexture, this.depthView);
  }

  /** Prepares visibility/batches/shared uploads and encodes the compiled graph without submitting or waiting. */
  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    this.resize();
    const indirect = this.submissionMode === "gpu-indirect";
    this.taa.begin();
    this.visibility.configureDependencies(indirect);
    const visible = this.visibility.prepare(indirect, this.width, this.height);
    this.visibility.prepareBatches(indirect, visible);
    this.uploads.upload(indirect, this.width, this.height);
    this.streaming.touch(this.frameNumber);
    this.streaming.quality.update(
      this.world,
      this.queue,
      this.camera,
      this.gpu.canvas.height,
      this.frameNumber,
    );
    this.graph.execute(encoder, view);
    this.stats.bufferUploadBytes += this.taa.uploadBytes;
    this.stats.transmissionMipPasses = this.transmission.mipPasses;
    this.stats.temporalUploadBytes = this.taa.uploadBytes;
    this.stats.temporalDrawCalls = this.taa.enabled
      ? this.taa.drawCalls + 1
      : 0;
    this.recordParticleStats();
    this.gpuProfiler.resolveFrame(encoder);
    this.profiler.end(CPUStage.encoding);
    this.markGPUCountsUnavailable(indirect);
  }

  /** Capture background only when a conservative visible alpha candidate has authored optical transmission. */
  private transmissionNeeded(): boolean {
    if (!this.transmission.enabled) return false;
    for (let n = 0; n < this.queue.transparentCount; n++) {
      const material = this.world.materialId[this.queue.transparent[n]!]!;
      if (this.materials.data[material * MATERIAL_WORDS + 32]! > 0) return true;
    }
    return false;
  }
  /** Combine particle owner counters with mesh totals after graph execution. */
  private recordParticleStats(): void {
    this.stats.particleCount = this.particles.enabled
      ? this.particles.count
      : 0;
    this.stats.particleVisibleCount = this.particleRenderer.billboardCount;
    this.stats.particleTrailVisibleSegments = this.particleRenderer.ribbonCount;
    this.stats.particleCulled =
      this.stats.particleCount - this.stats.particleVisibleCount;
    this.stats.particleTrailCulled = this.particles.enabled
      ? this.particles.trails.count - this.stats.particleTrailVisibleSegments
      : 0;
    this.stats.particleDrawCalls = this.particleRenderer.drawCalls;
    this.stats.particleUploadBytes = this.particleRenderer.uploadBytes;
    this.stats.particleRecordUploadBytes =
      this.particleRenderer.recordUploadBytes;
    this.stats.particleDropped = this.particles.dropped;
    this.stats.particleTrailSegments = this.particles.enabled
      ? this.particles.trails.count
      : 0;
    this.stats.particleTrailUploadBytes =
      this.particleRenderer.trailUploadBytes;
    this.stats.bufferUploadBytes += this.particleRenderer.uploadBytes;
    this.stats.drawCalls += this.particleRenderer.drawCalls;
    this.stats.pipelineSwitches += this.particleRenderer.drawCalls;
    this.stats.triangles +=
      (this.stats.particleVisibleCount +
        this.stats.particleTrailVisibleSegments) *
      2;
  }

  /** GPU-selected instance/triangle counts are unknown without a diagnostic readback. */
  private markGPUCountsUnavailable(indirect: boolean): void {
    if (this.geometryOptimization.count)
      this.stats.triangles = this.stats.instances = -1;
    if (indirect) {
      this.stats.lod0 =
        this.stats.lod1 =
        this.stats.lod2 =
        this.stats.lodOther =
        this.stats.lodCulled =
          -1;
      this.stats.visibleObjects =
        this.stats.frustumRejected =
        this.stats.culledObjects =
        this.stats.instances =
        this.stats.triangles =
          -1;
    }
  }

  /** Cold asynchronous upload/replacement; null removes the environment. */
  setEnvironment(data: EnvironmentData | null): Promise<void> {
    return this.environment.set(data);
  }

  /** Registers a surface shader on the cold path; publication waits for GPU validation. */
  registerMaterialShader(
    definition: import("./materials/MaterialShaderRegistry").MaterialShaderDefinition,
  ): Promise<number> {
    return this.colorPass.registerShader(definition);
  }
  /** Stops streaming publication and releases shared GPU resources and profiler ownership. */
  dispose(): void {
    this.taa.dispose();
    this.transmission.dispose();
    if (this.ownsStreaming) this.streaming.quality.dispose();
    this.particleRenderer.dispose();
    this.meshes.clearRecovery();
    this.environment.dispose();
    this.gpuProfiler.dispose();
    this.textures.dispose();
    this.resources.dispose();
  }
}
