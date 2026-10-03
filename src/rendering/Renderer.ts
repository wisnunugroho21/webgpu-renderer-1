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
import shadowShader from "../shaders/shadows.wgsl?raw";
import geometryShader from "../shaders/geometry.wgsl?raw";
import { ClusteredLighting } from "./lighting/ClusteredLighting";
import frameShader from "../shaders/frame.wgsl?raw";
import { LightBuffer } from "./LightBuffer";
import lightingShader from "../shaders/lighting.wgsl?raw";
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

import pbrShader from "../shaders/pbr.wgsl?raw";
import commonShader from "../shaders/common.wgsl?raw";
import morphShader from "../shaders/morphing.wgsl?raw";
import skinShader from "../shaders/skinning.wgsl?raw";
const shader = [
  frameShader,
  geometryShader,
  commonShader,
  morphShader,
  skinShader,
  shadowShader,
  lightingShader,
  pbrShader,
].join("\n");
import { MaterialTextures } from "./materials/MaterialTextures";

export class Renderer {
  readonly geometryOptimization: GeometryOptimization;
  readonly camera = new Camera();
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
  readonly streaming: RendererStreaming;
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
  private readonly frameData = new Float32Array(48);
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
  ) {
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
    const vertices = new Float32Array([
      -1, -1, 1, 0.2, 0.65, 1, 1, -1, 1, 0.2, 0.65, 1, 1, 1, 1, 0.2, 0.65, 1,
      -1, 1, 1, 0.2, 0.65, 1, 1, -1, -1, 0.9, 0.4, 0.2, -1, -1, -1, 0.9, 0.4,
      0.2, -1, 1, -1, 0.9, 0.4, 0.2, 1, 1, -1, 0.9, 0.4, 0.2, 1, -1, 1, 0.2,
      0.9, 0.5, 1, -1, -1, 0.2, 0.9, 0.5, 1, 1, -1, 0.2, 0.9, 0.5, 1, 1, 1, 0.2,
      0.9, 0.5, -1, -1, -1, 0.8, 0.3, 0.8, -1, -1, 1, 0.8, 0.3, 0.8, -1, 1, 1,
      0.8, 0.3, 0.8, -1, 1, -1, 0.8, 0.3, 0.8, -1, 1, 1, 1, 0.8, 0.2, 1, 1, 1,
      1, 0.8, 0.2, 1, 1, -1, 1, 0.8, 0.2, -1, 1, -1, 1, 0.8, 0.2, -1, -1, -1,
      0.4, 0.3, 0.8, 1, -1, -1, 0.4, 0.3, 0.8, 1, -1, 1, 0.4, 0.3, 0.8, -1, -1,
      1, 0.4, 0.3, 0.8,
    ]);
    const indices = new Uint16Array(36);
    for (let face = 0; face < 6; face++)
      indices.set(
        [0, 1, 2, 0, 2, 3].map((i) => face * 4 + i),
        face * 6,
      );
    const positions = new Float32Array(24 * 3),
      colors = new Float32Array(24 * 3);
    for (let i = 0; i < 24; i++)
      for (let j = 0; j < 3; j++) {
        positions[i * 3 + j] = vertices[i * 6 + j]!;
        colors[i * 3 + j] = vertices[i * 6 + 3 + j]!;
      }
    this.meshes.upload({
      attributes: { POSITION: positions, COLOR_0: colors },
      indices: new Uint32Array(indices),
      mode: 4,
      material: 0,
      targets: [],
    });
    this.vertexBuffer = this.meshes.get(0).vertex;
    this.indexBuffer = this.meshes.get(0).index;
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
    const module = this.resources.shaders.get(shader, "PBR shader");
    this.materialBuffer = materials.createBuffer(this.resources.buffers);
    const vertexBuffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: 104,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x4" },
          { shaderLocation: 2, offset: 28, format: "float32x3" },
          { shaderLocation: 3, offset: 40, format: "float32x2" },
          { shaderLocation: 4, offset: 48, format: "float32x4" },
          { shaderLocation: 5, offset: 64, format: "float32x2" },
          { shaderLocation: 6, offset: 72, format: "uint32x4" },
          { shaderLocation: 7, offset: 88, format: "float32x4" },
        ],
      },
    ];
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
      vertexBuffers,
    );
    this.depthPrepass = new DepthPrepass(
      this.resources,
      this.shadows,
      this.meshes,
      materials,
      this.textures,
    );
    const groupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: 192 },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage", minBindingSize: 64 },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage", minBindingSize: 80 },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: "read-only-storage",
            hasDynamicOffset: true,
            minBindingSize: 48,
          },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage", minBindingSize: 64 },
        },
        ...[5, 6, 7, 8].map((binding) => ({
          binding,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: "read-only-storage" as const,
            minBindingSize: binding === 5 ? 4 : 16,
          },
        })),
        {
          binding: 9,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage", minBindingSize: 64 },
        },
        ...[10, 11].map((binding) => ({
          binding,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: {
            type: "read-only-storage" as const,
            minBindingSize: binding === 10 ? 8 : 4,
          },
        })),
        {
          binding: 12,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage", minBindingSize: 80 },
        },
        {
          binding: 13,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "depth", viewDimension: "2d-array" },
        },
        {
          binding: 15,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage", minBindingSize: 16 },
        },
        {
          binding: 14,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "comparison" },
        },
      ],
    });
    this.geometryOptimization = new GeometryOptimization(
      device,
      this.resources,
      this.dynamic,
      world.capacity,
    );
    this.pipelineDescriptor = {
      label: "Cube pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [groupLayout, this.textures.layout],
      }),
      vertex: {
        module,
        entryPoint: "vs",
        buffers: vertexBuffers,
      },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [{ format: gpu.renderFormat }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    };
    this.pipeline = this.resources.pipelines.get(this.pipelineDescriptor);
    this.pipelines = Array.from({ length: 72 }, (_, variant) => {
      const index = variant % 18;
      return this.resources.pipelines.get({
        ...this.pipelineDescriptor,
        vertex: {
          ...this.pipelineDescriptor.vertex,
          entryPoint: variant >= 36 ? "vsIndirect" : "vs",
        },
        primitive: {
          ...this.pipelineDescriptor.primitive,
          topology:
            index % 3 === 0
              ? "triangle-list"
              : index % 3 === 1
                ? "line-list"
                : "point-list",
          cullMode:
            index % 3 !== 0 || Math.floor(index / 3) % 2 ? "none" : "back",
        },
        depthStencil: {
          ...this.pipelineDescriptor.depthStencil!,
          depthWriteEnabled: (variant >= 36 || variant % 36 < 18) && index < 12,
          depthCompare: variant % 36 < 18 ? "less" : "less-equal",
        },
        fragment: {
          ...this.pipelineDescriptor.fragment!,
          targets: [
            {
              format: gpu.renderFormat,
              ...(index >= 12
                ? {
                    blend: {
                      color: {
                        srcFactor: "src-alpha",
                        dstFactor: "one-minus-src-alpha",
                        operation: "add",
                      },
                      alpha: {
                        srcFactor: "one",
                        dstFactor: "one-minus-src-alpha",
                        operation: "add",
                      },
                    } as GPUBlendState,
                  }
                : {}),
            },
          ],
        },
      });
    });
    const alignment = this.dynamic.alignment;
    this.frameGroups = this.dynamic.buffers.map((buffer) =>
      device.createBindGroup({
        layout: groupLayout,
        entries: [
          { binding: 0, resource: { buffer, offset: 0, size: 192 } },
          {
            binding: 1,
            resource: { buffer, offset: alignment, size: world.capacity * 64 },
          },
          { binding: 2, resource: { buffer: this.materialBuffer } },
          { binding: 4, resource: { buffer: this.joints.buffer } },
          { binding: 5, resource: { buffer: this.morphWeights.buffer } },
          { binding: 6, resource: { buffer: this.morphDeltas.position } },
          { binding: 7, resource: { buffer: this.morphDeltas.normal } },
          { binding: 8, resource: { buffer: this.morphDeltas.tangent } },
          { binding: 9, resource: { buffer: this.lights.buffer } },
          { binding: 10, resource: { buffer: this.clusters.counts } },
          { binding: 11, resource: { buffer: this.clusters.indices } },
          { binding: 12, resource: { buffer: this.shadows.buffer } },
          { binding: 13, resource: this.shadows.view },
          { binding: 14, resource: this.shadows.sampler },
          { binding: 15, resource: { buffer: this.gpuDraws.visibleRecords } },
          {
            binding: 3,
            resource: { buffer, offset: 0, size: world.capacity * 48 },
          },
        ],
      }),
    );
    this.frameGroup = this.frameGroups[0]!;
    this.graph.add({
      name: "gpu-frustum",
      reads: ["frame", "geometry"],
      writes: ["gpuVisibility"],
      execute: (encoder) =>
        this.gpuFrustum.encode(
          encoder,
          this.dynamic.frameSlot,
          this.gpuProfiler,
        ),
    });
    this.graph.add({
      name: "shadows",
      reads: [
        "geometry",
        "instances",
        "materials",
        "deformation",
        "lights",
        "frame",
      ],
      writes: ["shadowDepth"],
      execute: (encoder) =>
        this.shadows.encode(encoder, this.world, this.stats, this.gpuProfiler),
    });
    this.graph.add({
      name: "light-clusters",
      reads: ["lights", "frame"],
      writes: ["clusterMetadata", "clusterIndices"],
      execute: (encoder) =>
        this.clusters.encode(encoder, this.dynamic.frameSlot, this.gpuProfiler),
    });
    this.graph.add({
      name: "depth",
      reads: ["geometry", "materials", "instances", "deformation", "frame"],
      writes: ["prepassDepth"],
      execute: (encoder) =>
        this.depthPrepass.encode(
          encoder,
          this.depthView!,
          this.dynamic.frameSlot,
          this.colorInstanceOffset,
          this.batches,
          this.stats,
          this.gpuProfiler,
        ),
    });
    this.graph.add({
      name: "geometry-clusters",
      reads: ["frame", "geometry", "instances"],
      writes: ["geometryArguments"],
      execute: (encoder) =>
        this.geometryOptimization.encode(
          encoder,
          this.dynamic.frameSlot,
          this.colorInstanceOffset,
          this.gpuProfiler,
        ),
    });
    this.graph.add({
      name: "color",
      reads: [
        "geometry",
        "materials",
        "instances",
        "deformation",
        "lights",
        "frame",
        "drawArguments",
        "geometryArguments",
        "prepassDepth",
        "shadowDepth",
        "clusterMetadata",
        "clusterIndices",
      ],
      writes: ["mainDepth", "swapchain"],
      execute: (encoder, view) => this.encodeColor(encoder, view),
    });
    this.graph.add({
      name: "hiz",
      reads: ["prepassDepth"],
      writes: ["hizDepth"],
      execute: (encoder) => {
        if (!this.temporal.reuse) this.hiz.encode(encoder, this.gpuProfiler);
        else this.hiz.passes = 0;
      },
    });
    this.graph.add({
      name: "hiz-debug",
      reads: ["hizDepth", "swapchain"],
      writes: ["finalSwapchain"],
      execute: (encoder, view) => this.hiz.debug(encoder, view),
    });
    this.graph.add({
      name: "gpu-occlusion",
      reads: ["gpuVisibility", "hizDepth", "frame", "geometry"],
      writes: ["gpuOcclusionVisibility"],
      execute: (encoder) => {
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
    });
    this.graph.add({
      name: "gpu-compaction",
      reads: ["gpuLODVisibility"],
      writes: ["visibleInstances", "visibleCounter"],
      execute: (encoder) =>
        this.gpuCompaction.encode(encoder, this.gpuProfiler),
    });
    this.graph.add({
      name: "gpu-indirect",
      reads: ["visibleInstances", "visibleCounter"],
      writes: ["drawArguments"],
      execute: (encoder) => this.gpuDraws.encode(encoder, this.gpuProfiler),
    });
    this.graph.add({
      name: "gpu-lod",
      reads: ["gpuOcclusionVisibility", "frame", "geometry"],
      writes: ["gpuLODVisibility", "gpuLODSelections"],
      execute: (encoder) =>
        this.gpuLOD.encode(encoder, this.dynamic.frameSlot, this.gpuProfiler),
    });
    this.graph.compile();
    this.resize();
  }

  resize(): void {
    const { width, height } = this.gpu.canvas;
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
    if (this.gpuOcclusion.enabled) {
      this.gpuFrustum.enabled = true;
      this.hiz.enabled = true;
    }
    if (this.gpuCompaction.enabled) this.gpuFrustum.enabled = true;
    const indirect = this.submissionMode === "gpu-indirect";
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
    this.profiler.start(CPUStage.encoding);
    this.gpuProfiler.beginFrame(this.frameNumber);
    this.dynamic.beginFrame(this.frameNumber++);
    this.frameData.set(this.camera.viewProjection);
    this.frameData.set(this.camera.position, 16);
    this.frameData[19] = this.world.lightCount;
    this.frameData.set(this.camera.view, 20);
    const clustered = this.clusters.choose(this.world);
    this.frameData[36] = this.clusters.tilesX;
    this.frameData[37] = this.clusters.tilesY;
    this.frameData[38] = this.clusters.tileSize;
    this.frameData[39] = this.clusters.slices;
    this.frameData[40] = 0.1;
    this.frameData[41] = 100;
    this.frameData[42] = clustered ? 1 : 0;
    this.frameData[43] = this.clusters.maxLights;
    this.frameData[44] = this.gpu.canvas.width;
    this.frameData[45] = this.gpu.canvas.height;
    this.frameData[46] = this.camera.projection[0]!;
    this.frameData[47] = this.camera.projection[5]!;
    this.dynamic.write(this.dynamic.allocate(192), this.frameData);
    this.dynamic.write(
      this.dynamic.allocate(Math.max(64, this.world.count * 64)),
      this.world.matrices.subarray(0, Math.max(16, this.world.count * 16)),
    );
    this.instances.update(this.queue, this.world, this.meshes);
    const instanceOffset = this.dynamic.allocate(
      Math.max(48, this.queue.count * 48),
      this.gpu.device.limits.minStorageBufferOffsetAlignment,
    );
    this.dynamic.write(
      instanceOffset,
      this.instances.data.subarray(0, Math.max(12, this.queue.count * 12)),
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

  private encodeColor(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    const pass = encoder.beginRenderPass({
      label: "Opaque cube",
      timestampWrites: this.gpuProfiler.writes(GPUPass.color),
      colorAttachments: [
        {
          view,
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
    pass.setBindGroup(0, this.frameGroups[this.dynamic.frameSlot]!, [
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
          this.pipelines[
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
    this.gpuProfiler.dispose();
    this.textures.dispose();
    this.resources.dispose();
  }
}
