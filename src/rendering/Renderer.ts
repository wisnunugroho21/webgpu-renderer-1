import { copyRendererSettings } from "./copyRendererSettings";
import { ParticleSystem } from "../particles/ParticleSystem";
import { ParticleRenderer } from "./particles/ParticleRenderer";
import { createRendererResources } from "./createRendererResources";
import { ColorPass } from "./passes/ColorPass";
import { EnvironmentSkybox } from "./environment/EnvironmentSkybox";
import { HDRRendering } from "./post/HDRRendering";
import { EnvironmentData } from "./environment/EnvironmentData";
import { EnvironmentLighting } from "./environment/EnvironmentLighting";
import { FrameUniforms } from "./FrameUniforms";
import {
  FRAME_BYTES,
  MATRIX_BYTES,
  MATRIX_WORDS,
  INSTANCE_BYTES,
  INSTANCE_WORDS,
} from "./layouts";
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
  readonly environment: EnvironmentLighting;
  readonly skybox: EnvironmentSkybox;
  readonly hdr: HDRRendering;
  /** Returns the presentation anti-aliasing mode owned by the HDR/presentation subsystem. */
  get antialiasing(): "none" | "fxaa" {
    return this.hdr.antialiasing;
  }
  /** Selects presentation anti-aliasing and lets its owner prepare any required targets. */
  set antialiasing(value: "none" | "fxaa") {
    this.hdr.antialiasing = value;
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
  visibilityMode: "linear" | "bvh" = "linear";
  private bvhRevision = -1;
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
  private colorInstanceOffset = 0;
  private readonly frameUniforms = new FrameUniforms();
  readonly pipelines: readonly GPURenderPipeline[];
  private frameNumber = 0;
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

  /** Initializes frame visibility, batching, shared uploads and graph execution. */
  constructor(
    readonly gpu: GPUContext,
    readonly world: RenderWorld,
    readonly materials: MaterialManager,
    readonly profiler = new CPUProfiler(),
    camera?: Camera,
    readonly particles = new ParticleSystem(),
  ) {
    this.camera = camera ?? new Camera();
    const shared = createRendererResources(
      gpu,
      world,
      materials,
      this.lodGroups,
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
    const color = this.colorPass.base;
    this.pipelineDescriptor = color.pipelineDescriptor;
    this.pipeline = color.pipeline;
    this.pipelines = color.pipelines;
    this.frameGroup = color.frameGroups[0]!;
    this.particleRenderer = new ParticleRenderer(
      gpu,
      this.resources,
      particles,
    );
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
          this.colorInstanceOffset,
          this.batches,
          this.stats,
          this.gpuProfiler,
        ),
      /** Cull prepared geometry clusters before color selects indirect cluster draws. */
      geometryClusters: (encoder) =>
        this.geometryOptimization.encode(
          encoder,
          this.dynamic.frameSlot,
          this.colorInstanceOffset,
          this.gpuProfiler,
        ),
      /** Draw the sorted scene into the current direct or linear scene target. */
      color: (encoder, view) =>
        this.colorPass.encode(
          encoder,
          view,
          this.depthView!,
          this.colorInstanceOffset,
          this.clearColor,
        ),
      /** Composite particles into linear scene color after geometry and before HDR effects. */
      particles: (encoder, view) =>
        this.particleRenderer.encode(
          encoder,
          this.hdr.sceneEnabled ? this.hdr.view! : view,
          this.depthView!,
          this.camera,
          this.hdr.sceneEnabled,
        ),
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
    this.frameNumber = previous.frameNumber;
    copyRendererSettings(this, previous);
  }
  /** Rebinds resident streaming ownership to recovered GPU owners while retaining its CPU records. */
  restoreStreaming(
    previous: Renderer,
    remap: Map<GPUBindGroup[], GPUBindGroup[]>,
  ): void {
    previous.streaming.rebind(
      this.gpu.queue,
      this.meshes,
      this.lodGroups,
      this.textures,
      remap,
      () =>
        /** Returns the current frame stamp for safe retirement and temporal resource tracking. */ this
          .frameNumber,
    );
    this.streaming = previous.streaming;
  }

  /** Recreates only size-dependent render targets when physical canvas dimensions change. */
  resize(): void {
    const { width, height } = this.gpu.canvas;
    this.hdr.resize(width, height);
    if (width === this.width && height === this.height) return;
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
    this.hiz.resize(width, height, this.depthView);
    this.gpuOcclusion.resize(this.hiz.texture!);
  }

  /** Prepares visibility/batches/shared uploads and encodes the compiled graph without submitting or waiting. */
  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    this.resize();
    const indirect = this.submissionMode === "gpu-indirect";
    this.configureFeatureDependencies(indirect);
    const visible = this.prepareVisibility(indirect);
    this.prepareBatches(indirect, visible);
    this.uploadFrameState(indirect);
    this.streaming.touch(this.frameNumber);
    this.graph.execute(encoder, view);
    this.recordParticleStats();
    this.gpuProfiler.resolveFrame(encoder);
    this.profiler.end(CPUStage.encoding);
    this.markGPUCountsUnavailable(indirect);
  }

  /** Combine particle owner counters with mesh totals after graph execution. */
  private recordParticleStats(): void {
    this.stats.particleCount = this.particles.enabled
      ? this.particles.count
      : 0;
    this.stats.particleDrawCalls = this.particleRenderer.drawCalls;
    this.stats.particleUploadBytes = this.particleRenderer.uploadBytes;
    this.stats.particleRecordUploadBytes =
      this.particleRenderer.recordUploadBytes;
    this.stats.particleDropped = this.particles.dropped;
    this.stats.bufferUploadBytes += this.particleRenderer.uploadBytes;
    this.stats.drawCalls += this.particleRenderer.drawCalls;
    this.stats.pipelineSwitches += this.particleRenderer.drawCalls;
    this.stats.triangles += this.stats.particleCount * 2;
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

  /** Optional GPU paths enable their prerequisites before any visibility work. */
  private configureFeatureDependencies(indirect: boolean): void {
    if (this.gpuOcclusion.enabled) {
      this.gpuFrustum.enabled = true;
      this.hiz.enabled = true;
    }
    if (this.gpuCompaction.enabled) this.gpuFrustum.enabled = true;
    this.gpuDraws.enabled = indirect;
    if (indirect) {
      if (!this.gpuDraws.supported)
        throw new Error("GPU indirect mode requires indirect-first-instance");
      this.gpuFrustum.enabled =
        this.gpuCompaction.enabled =
        this.gpuLOD.enabled =
          true;
      for (let i = 0; i < this.world.count; i++)
        if (this.world.lodGroup[i]! >= 0)
          this.world.meshId[i] =
            this.lodGroups.entries[this.world.lodGroup[i]!]!.meshes[0]!;
    }
    this.depthPrepass.skipLOD = indirect;
    if (this.gpuLOD.enabled) this.gpuFrustum.enabled = true;
    if (this.hiz.enabled || this.hiz.debugEnabled || this.gpuOcclusion.enabled)
      this.depthPrepass.enabled = true;
  }

  /** CPU culling and LOD produce the queue input; indirect mode leaves selection to the GPU. */
  private prepareVisibility(indirect: boolean): number {
    this.camera.update(this.width / this.height);
    this.stats.reset();
    this.profiler.start(CPUStage.culling);
    this.frustum.setFromMatrix(this.camera.viewProjection);
    if (
      this.visibilityMode === "bvh" &&
      this.bvhRevision !== this.world.staticRevision
    ) {
      this.bvh.build(this.world);
      this.bvhRevision = this.world.staticRevision;
    }
    const frustumVisible =
      this.cullingEnabled && !indirect
        ? this.visibilityMode === "bvh"
          ? this.bvh.cull(this.world, this.frustum, this.culler)
          : this.culler.cull(this.world, this.frustum)
        : this.world.count;
    this.stats.totalRenderables = this.world.count;
    this.stats.frustumTested =
      this.cullingEnabled && !indirect
        ? this.visibilityMode === "bvh"
          ? this.bvh.objectsTested
          : this.world.count
        : 0;
    this.stats.bvhNodesTested =
      this.cullingEnabled && this.visibilityMode === "bvh"
        ? this.bvh.nodesTested
        : 0;
    const input =
      this.cullingEnabled && !indirect
        ? this.visibilityMode === "bvh"
          ? this.bvh.visible
          : this.culler.visible
        : undefined;
    const visible = indirect
      ? this.world.count
      : this.lodSelector.select(
          this.world,
          this.camera,
          this.gpu.canvas.height,
          input,
          frustumVisible,
        );
    this.stats.lod0 = this.lodSelector.distribution[0]!;
    this.stats.lod1 = this.lodSelector.distribution[1]!;
    this.stats.lod2 = this.lodSelector.distribution[2]!;
    this.stats.lodOther = 0;
    for (let level = 3; level < 8; level++)
      this.stats.lodOther += this.lodSelector.distribution[level]!;
    this.stats.lodCulled = this.lodSelector.culled;
    this.stats.visibleObjects = visible;
    this.stats.culledObjects = this.world.count - visible;
    this.stats.frustumRejected = this.world.count - frustumVisible;
    this.profiler.end(CPUStage.culling);
    return visible;
  }

  /** Sorting establishes stable pipeline/material/mesh runs before shared instance packing. */
  private prepareBatches(indirect: boolean, visible: number): void {
    this.profiler.start(CPUStage.sorting);
    this.queue.build(
      this.world,
      this.materials,
      this.camera.view,
      indirect ? undefined : this.lodSelector.visible,
      visible,
    );
    for (let i = 0; i < this.world.count; i++)
      this.queue.pipeline[i] = this.materials.colorPipelineIndex(
        this.world.materialId[i]!,
        this.meshes.get(this.world.meshId[i]!).topology,
      );
    this.sorter.lodAware = indirect;
    this.sorter.sort(
      this.queue,
      this.world,
      this.submissionMode !== "individual",
    );
    this.batches.build(
      this.queue,
      this.world,
      this.submissionMode === "instanced" || indirect,
      indirect,
    );
    this.profiler.end(CPUStage.sorting);
  }

  /** Reuse arena slots and persistent staging arrays. No GPU objects are created here. */
  private uploadFrameState(indirect: boolean): void {
    this.profiler.start(CPUStage.encoding);
    this.environment.flush(this.skybox.enabled);
    this.skybox.update(this.camera);
    this.gpuProfiler.beginFrame(this.frameNumber);
    this.dynamic.beginFrame(this.frameNumber++);
    const clustered = this.clusters.choose(this.world);
    this.frameUniforms.update(
      this.camera,
      this.world.lightCount,
      this.clusters,
      clustered,
      this.width,
      this.height,
    );
    this.dynamic.write(
      this.dynamic.allocate(FRAME_BYTES),
      this.frameUniforms.data,
    );
    this.dynamic.write(
      this.dynamic.allocate(
        Math.max(MATRIX_BYTES, this.world.count * MATRIX_BYTES),
      ),
      this.world.matrices.subarray(
        0,
        Math.max(MATRIX_WORDS, this.world.count * MATRIX_WORDS),
      ),
    );
    this.instances.update(this.queue, this.world, this.meshes);
    const instanceOffset = this.dynamic.allocate(
      Math.max(INSTANCE_BYTES, this.queue.count * INSTANCE_BYTES),
      this.gpu.device.limits.minStorageBufferOffsetAlignment,
    );
    this.dynamic.write(
      instanceOffset,
      this.instances.data.subarray(
        0,
        Math.max(INSTANCE_WORDS, this.queue.count * INSTANCE_WORDS),
      ),
    );
    this.shadows.prepare(this.world, this.camera, this.gpu.queue, this.stats);
    this.dynamic.flush(this.gpu.queue);
    this.materials.upload(this.gpu.queue, this.materialBuffer);
    this.colorPass.uploadParameters();
    this.joints.upload(this.gpu.queue, this.world);
    this.morphWeights.upload(this.gpu.queue, this.world);
    this.lights.upload(this.gpu.queue, this.world);
    this.prepareGPUPaths(indirect);
    this.recordUploadStats(clustered);
    this.colorInstanceOffset = instanceOffset;
  }

  /** Prepare optional compute inputs after all shared frame writes; the graph performs actual dispatches. */
  private prepareGPUPaths(indirect: boolean): void {
    this.gpuFrustum.update(this.world, this.gpu.queue);
    const temporalEnabled = this.temporal.enabled;
    if (!this.gpuOcclusion.enabled) this.temporal.enabled = false;
    this.temporal.prepare(
      this.world,
      this.camera,
      this.materials.revision,
      this.width,
      this.height,
      indirect,
    );
    this.temporal.enabled = temporalEnabled;
    this.gpuLOD.prepare(this.world, this.gpu.queue);
    this.gpuDraws.prepare(
      this.world,
      this.queue,
      this.batches,
      this.meshes,
      this.materials,
      this.gpu.queue,
    );
    this.geometryOptimization.prepare(
      this.batches,
      this.queue,
      this.world,
      this.meshes,
      this.camera.viewProjection,
      this.cullingEnabled,
      indirect,
      this.gpu.queue,
    );
  }

  /** Report bytes from their owners without changing dirty-range decisions or upload ordering. */
  private recordUploadStats(clustered: boolean): void {
    this.stats.geometryClusterCandidates = this.geometryOptimization.count;
    this.stats.geometryFallbackBatches =
      this.geometryOptimization.fallbackBatches;
    this.stats.geometryUploadBytes = this.geometryOptimization.uploadBytes;
    this.stats.indirectUploadBytes = this.gpuDraws.uploadBytes;
    this.stats.gpuCandidates = this.gpuFrustum.enabled
      ? this.gpuFrustum.count
      : 0;
    this.stats.gpuObjectUploadBytes = this.gpuFrustum.uploadBytes;
    this.stats.lights = this.world.lightCount;
    this.stats.lightUploadBytes = this.lights.uploadBytes;
    this.stats.morphUploadBytes = this.morphWeights.uploadBytes;
    this.stats.activeMorphStates = this.world.activeMorphStates;
    this.stats.activeMorphTargets = this.world.activeMorphTargets;
    this.stats.morphTargets = this.world.morphTargets;
    this.stats.activeSkeletons = this.world.activeSkeletons;
    this.stats.jointCount = this.world.activeJoints;
    this.stats.updatedJoints = this.joints.updatedJoints;
    this.stats.jointUploadBytes = this.joints.uploadBytes;
    this.stats.bufferUploadBytes =
      this.dynamic.uploadBytes +
      this.materials.uploadBytes +
      this.materials.shaderUploadBytes +
      this.joints.uploadBytes +
      this.morphWeights.uploadBytes +
      this.lights.uploadBytes +
      this.stats.shadowUploadBytes +
      this.gpuFrustum.uploadBytes +
      this.gpuDraws.uploadBytes +
      this.gpuLOD.uploadBytes +
      this.geometryOptimization.uploadBytes;

    this.stats.clusters = clustered
      ? this.clusters.tilesX * this.clusters.tilesY * this.clusters.slices
      : 0;
  }

  /** Registers a surface shader on the cold path; publication waits for GPU validation. */
  registerMaterialShader(
    definition: import("./materials/MaterialShaderRegistry").MaterialShaderDefinition,
  ): Promise<number> {
    return this.colorPass.registerShader(definition);
  }
  /** Stops streaming publication and releases shared GPU resources and profiler ownership. */
  dispose(): void {
    this.particleRenderer.dispose();
    this.meshes.clearRecovery();
    this.environment.dispose();
    this.gpuProfiler.dispose();
    this.textures.dispose();
    this.resources.dispose();
  }
}
