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
import { createBootstrapMesh } from "./geometry/createBootstrapMesh";
import { MESH_VERTEX_LAYOUT } from "./geometry/VertexLayout";
import {
  ColorResourcesInput,
  createColorResources,
} from "./pipelines/createColorResources";
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
import { GPUProfiler, GPUPass } from "../profiling/GPUProfiler";
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

export class Renderer {
  readonly environment: EnvironmentLighting;
  readonly skybox: EnvironmentSkybox;
  readonly hdr: HDRRendering;
  private hdrColor?: ReturnType<typeof createColorResources>;
  private hdrEnvironmentColor?: ReturnType<typeof createColorResources>;
  private environmentLayout?: GPUBindGroupLayout;
  private readonly colorInput: ColorResourcesInput;
  private environmentColor?: ReturnType<typeof createColorResources>;
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
  private readonly frameGroups: GPUBindGroup[];
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

  constructor(
    readonly gpu: GPUContext,
    readonly world: RenderWorld,
    readonly materials: MaterialManager,
    readonly profiler = new CPUProfiler(),
    camera?: Camera,
  ) {
    this.camera = camera ?? new Camera();
    const device = gpu.device;
    this.resources = new Resources(device);
    this.temporal = new TemporalVisibility(world);
    this.previousVisibility = this.resources.buffers.create({
      label: "Previous visibility",
      size: Math.max(4, world.capacity * 4),
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.gpuProfiler = new GPUProfiler(device, this.resources);
    this.hiz = new HiZPyramid(device, this.resources, gpu.renderFormat);
    this.lights = new LightBuffer(this.resources.buffers, world.lightCapacity);
    this.joints = new JointMatrixBuffer(
      this.resources.buffers,
      world.jointCapacity,
    );
    this.textures = new MaterialTextures(device, this.resources);
    this.morphDeltas = new MorphDeltaBuffers(this.resources, gpu.queue);
    this.morphWeights = new MorphWeightBuffer(
      this.resources.buffers,
      world.morphCapacity,
    );
    this.meshes = new MeshManager(this.resources, gpu.queue, this.morphDeltas);
    this.streaming = new RendererStreaming(
      gpu.queue,
      this.meshes,
      this.lodGroups,
      this.textures,
      materials,
      () => this.frameNumber,
      world,
    );
    this.queue = new RenderQueue(world.capacity);
    this.lodSelector = new LODSelector(world.capacity, this.lodGroups);
    this.culler = new FrustumCuller(world.capacity);
    this.bvh = new BVH(world.capacity);
    this.instances = new InstanceManager(world.capacity);
    this.batches = new BatchBuilder(world.capacity);
    const bootstrapMesh = createBootstrapMesh(this.meshes);
    this.vertexBuffer = this.meshes.get(bootstrapMesh).vertex;
    this.indexBuffer = this.meshes.get(bootstrapMesh).index;
    this.dynamic = new DynamicBufferAllocator(
      this.resources.buffers,
      4 * 1024 * 1024,
      device.limits.minUniformBufferOffsetAlignment,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE,
    );
    this.frameBuffer = this.dynamic.buffers[0]!;
    this.gpuFrustum = new GPUFrustumCuller(
      device,
      this.resources,
      this.dynamic.buffers,
      world.capacity,
    );
    this.gpuOcclusion = new GPUOcclusionCuller(
      device,
      this.resources,
      this.dynamic.buffers,
      this.gpuFrustum,
    );
    this.gpuCompaction = new VisibilityCompactor(
      device,
      this.resources,
      this.gpuFrustum,
    );
    this.gpuLOD = new GPULODSelector(
      device,
      this.resources,
      this.dynamic.buffers,
      this.gpuFrustum,
      this.lodGroups,
    );
    this.gpuDraws = new IndirectDraws(
      device,
      this.resources,
      world.capacity,
      this.gpuCompaction,
      this.gpuLOD,
    );
    this.clusters = new ClusteredLighting(
      device,
      this.resources,
      this.dynamic.buffers,
      this.lights.buffer,
      gpu.canvas.width,
      gpu.canvas.height,
    );

    this.materialBuffer = materials.createBuffer(this.resources.buffers);
    this.shadows = new ShadowManager(
      device,
      this.resources,
      this.dynamic,
      world,
      [
        this.frameBuffer,
        this.frameBuffer,
        this.materialBuffer,
        this.frameBuffer,
        this.joints.buffer,
        this.morphWeights.buffer,
        this.morphDeltas.position,
        this.morphDeltas.normal,
        this.morphDeltas.tangent,
      ],
      this.meshes,
      materials,
      this.textures,
      MESH_VERTEX_LAYOUT,
    );
    this.depthPrepass = new DepthPrepass(
      this.resources,
      this.shadows,
      this.meshes,
      materials,
      this.textures,
    );
    this.geometryOptimization = new GeometryOptimization(
      device,
      this.resources,
      this.dynamic,
      world.capacity,
    );
    this.colorInput = {
      gpu,
      world,
      resources: this.resources,
      dynamic: this.dynamic,
      materialBuffer: this.materialBuffer,
      textures: this.textures,
      joints: this.joints,
      morphWeights: this.morphWeights,
      morphDeltas: this.morphDeltas,
      lights: this.lights,
      clusters: this.clusters,
      shadows: this.shadows,
      gpuDraws: this.gpuDraws,
    };
    const color = createColorResources(this.colorInput);
    this.hdr = new HDRRendering(gpu, this.resources, () => {
      this.hdrColor ??= createColorResources({
        ...this.colorInput,
        colorFormat: "rgba16float",
      });
      this.prepareHDREnvironment();
    });
    this.skybox = new EnvironmentSkybox(
      gpu,
      this.resources,
      () => this.environmentLayout,
    );
    this.environment = new EnvironmentLighting(
      device,
      this.resources,
      (environmentLayout) => {
        this.environmentLayout = environmentLayout;
        if (this.skybox.enabled) this.skybox.prepare(environmentLayout);
        // Prepare retained HDR variants even when the feature is temporarily disabled.
        if (this.hdrColor) this.prepareHDREnvironment();
        this.environmentColor ??= createColorResources({
          ...this.colorInput,
          environmentLayout,
        });
      },
    );
    this.pipelineDescriptor = color.pipelineDescriptor;
    this.pipeline = color.pipeline;
    this.pipelines = color.pipelines;
    this.frameGroups = color.frameGroups;
    this.frameGroup = this.frameGroups[0]!;
    configureRenderGraph(this.graph, {
      gpuFrustum: (encoder) =>
        this.gpuFrustum.encode(
          encoder,
          this.dynamic.frameSlot,
          this.gpuProfiler,
        ),
      shadows: (encoder) =>
        this.shadows.encode(encoder, this.world, this.stats, this.gpuProfiler),
      lightClusters: (encoder) =>
        this.clusters.encode(encoder, this.dynamic.frameSlot, this.gpuProfiler),
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
      geometryClusters: (encoder) =>
        this.geometryOptimization.encode(
          encoder,
          this.dynamic.frameSlot,
          this.colorInstanceOffset,
          this.gpuProfiler,
        ),
      color: (encoder, view) => this.encodeColor(encoder, view),
      toneMapping: (encoder, view) =>
        this.hdr.encode(encoder, view, this.gpuProfiler),
      hiz: (encoder) => {
        if (!this.temporal.reuse) this.hiz.encode(encoder, this.gpuProfiler);
        else this.hiz.passes = 0;
      },
      hizDebug: (encoder, view) => this.hiz.debug(encoder, view),
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
      gpuCompaction: (encoder) =>
        this.gpuCompaction.encode(encoder, this.gpuProfiler),
      gpuIndirect: (encoder) => this.gpuDraws.encode(encoder, this.gpuProfiler),
      gpuLod: (encoder) =>
        this.gpuLOD.encode(encoder, this.dynamic.frameSlot, this.gpuProfiler),
    });
    this.resize();
  }

  /** Cold device recovery: preserve CPU controls, never transfer old-device GPU objects. */
  restoreSettings(previous: Renderer): void {
    this.frameNumber = previous.frameNumber;
    this.camera.copyFrom(previous.camera);
    Object.assign(this.clearColor, previous.clearColor);
    this.submissionMode = previous.submissionMode;
    this.cullingEnabled = previous.cullingEnabled;
    this.visibilityMode = previous.visibilityMode;
    this.lodGroups.entries.push(...previous.lodGroups.entries);
    this.clusters.mode = previous.clusters.mode;
    this.shadows.enabled = previous.shadows.enabled;
    this.shadows.cacheEnabled = previous.shadows.cacheEnabled;
    this.shadows.cullingEnabled = previous.shadows.cullingEnabled;
    this.shadows.cascades = previous.shadows.cascades;
    this.shadows.shadowDistance = previous.shadows.shadowDistance;
    this.depthPrepass.enabled = previous.depthPrepass.enabled;
    this.hiz.enabled = previous.hiz.enabled;
    this.hiz.debugEnabled = previous.hiz.debugEnabled;
    this.hiz.debugMip = previous.hiz.debugMip;
    this.gpuFrustum.enabled = previous.gpuFrustum.enabled;
    this.gpuOcclusion.enabled = previous.gpuOcclusion.enabled;
    this.gpuCompaction.enabled = previous.gpuCompaction.enabled;
    this.gpuLOD.enabled = previous.gpuLOD.enabled;
    this.temporal.enabled = previous.temporal.enabled;
    this.geometryOptimization.enabled = previous.geometryOptimization.enabled;
    this.gpuProfiler.enabled = previous.gpuProfiler.enabled;
    this.skybox.enabled = previous.skybox.enabled;
    this.hdr.exposure = previous.hdr.exposure;
    this.hdr.toneMapping = previous.hdr.toneMapping;
    this.hdr.enabled = previous.hdr.enabled;
  }
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
      () => this.frameNumber,
    );
    this.streaming = previous.streaming;
  }

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

  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    this.resize();
    const indirect = this.submissionMode === "gpu-indirect";
    this.configureFeatureDependencies(indirect);
    const visible = this.prepareVisibility(indirect);
    this.prepareBatches(indirect, visible);
    this.uploadFrameState(indirect);
    this.streaming.touch(this.frameNumber);
    this.graph.execute(encoder, view);
    this.gpuProfiler.resolveFrame(encoder);
    this.profiler.end(CPUStage.encoding);
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
      this.queue.pipeline[i] =
        this.materials.pipelineIndex(this.world.materialId[i]!) * 3 +
        this.meshes.get(this.world.meshId[i]!).topology;
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
    this.joints.upload(this.gpu.queue, this.world);
    this.morphWeights.upload(this.gpu.queue, this.world);
    this.lights.upload(this.gpu.queue, this.world);
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
    this.colorInstanceOffset = instanceOffset;
  }

  private prepareHDREnvironment(): void {
    if (this.environmentLayout)
      this.hdrEnvironmentColor ??= createColorResources({
        ...this.colorInput,
        colorFormat: "rgba16float",
        environmentLayout: this.environmentLayout,
      });
  }

  private encodeColor(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    const pass = encoder.beginRenderPass({
      label: "Opaque cube",
      timestampWrites: this.gpuProfiler.writes(GPUPass.color),
      colorAttachments: [
        {
          view: this.hdr.enabled ? this.hdr.view! : view,
          clearValue: this.clearColor,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthView!,
        depthClearValue: 1,
        depthLoadOp: this.depthPrepass.enabled ? "load" : "clear",
        depthStoreOp: "store",
      },
    });
    this.skybox.encode(
      pass,
      this.environment.group,
      this.hdr.enabled ? "rgba16float" : this.gpu.renderFormat,
    );
    const environment = this.environment.active;
    const colors = this.hdr.enabled
      ? environment
        ? this.hdrEnvironmentColor!
        : this.hdrColor!
      : environment
        ? this.environmentColor!
        : undefined;
    const pipelines = colors?.pipelines ?? this.pipelines;
    const frameGroups = colors?.frameGroups ?? this.frameGroups;
    if (environment) pass.setBindGroup(2, this.environment.group!);
    pass.setBindGroup(0, frameGroups[this.dynamic.frameSlot]!, [
      this.colorInstanceOffset,
    ]);
    let previousPipeline = -1,
      previousMaterial = -1,
      previousMesh = -1;
    const batches = this.gpuDraws.enabled
      ? this.gpuDraws.batches
      : this.batches;
    for (let i = 0; i < batches.count; i++) {
      const mesh = batches.mesh[i]!,
        material = batches.material[i]!,
        pipeline = batches.pipeline[i]!,
        count = batches.instanceCount[i]!;
      const geometry = this.meshes.get(mesh);
      if (pipeline !== previousPipeline) {
        pass.setPipeline(
          pipelines[
            pipeline +
              (this.depthPrepass.enabled ? 18 : 0) +
              (this.gpuDraws.enabled ? 36 : 0)
          ]!,
        );
        previousPipeline = pipeline;
        this.stats.pipelineSwitches++;
      }
      if (material !== previousMaterial) {
        previousMaterial = material;
        pass.setBindGroup(
          1,
          this.textures.groups[material] ?? this.textures.fallback,
        );
        this.stats.materialSwitches++;
      }
      if (mesh !== previousMesh) {
        previousMesh = mesh;
        this.stats.meshSwitches++;
        pass.setVertexBuffer(0, geometry.vertex);
        pass.setIndexBuffer(geometry.index, "uint32");
      }
      if (this.gpuDraws.enabled) {
        pass.drawIndexedIndirect(this.gpuDraws.arguments, i * 20);
        this.stats.indirectDraws++;
      } else if (this.geometryOptimization.clusterCount[i]) {
        const first = this.geometryOptimization.firstCluster[i]!,
          count = this.geometryOptimization.clusterCount[i]!;
        for (let c = first; c < first + count; c++)
          pass.drawIndexedIndirect(
            this.geometryOptimization.arguments!,
            c * 20,
          );
        this.stats.geometryClusterDraws += count;
        this.stats.indirectDraws += count;
        this.stats.drawCalls += count - 1;
      } else
        pass.drawIndexed(
          geometry.indexCount,
          count,
          0,
          0,
          batches.firstInstance[i]!,
        );
      this.stats.drawCalls++;
      this.stats.instances += count;
      if (geometry.topology === 0)
        this.stats.triangles += (geometry.indexCount / 3) * count;
    }
    pass.end();
  }

  dispose(): void {
    this.meshes.clearRecovery();
    this.environment.dispose();
    this.gpuProfiler.dispose();
    this.textures.dispose();
    this.resources.dispose();
  }
}
