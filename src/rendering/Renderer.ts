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

const shader = /* wgsl */ `
struct Frame { viewProjection: mat4x4<f32> }
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> objectTransforms: array<mat4x4<f32>>;
struct Material { baseColor: vec4<f32>, surface: vec4<f32> }
struct Instance { transformIndex:u32, materialIndex:u32, jointOffset:u32, jointCount:u32, morphWeightOffset:u32, morphTargetCount:u32, objectId:u32, flags:u32 }
@group(0) @binding(2) var<storage, read> materials: array<Material>;
@group(0) @binding(3) var<storage, read> instances: array<Instance>;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) @interpolate(flat) materialId: u32,
}
@vertex fn vs(@location(0) position: vec3<f32>, @location(1) color: vec3<f32>, @builtin(instance_index) instance: u32) -> VertexOutput {
  var out: VertexOutput;
  let info = instances[instance];
  out.position = frame.viewProjection * objectTransforms[info.transformIndex] * vec4<f32>(position, 1.0);
  out.color = color;
  out.materialId = info.materialIndex;
  return out;
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
  let material = materials[input.materialId];
  if material.surface.z == 1.0 && material.baseColor.a < material.surface.w { discard; }
  return vec4<f32>(input.color * material.baseColor.rgb, select(1.0, material.baseColor.a, material.surface.z == 2.0));
}`;

export class Renderer {
  readonly camera = new Camera();
  readonly queue: RenderQueue;
  readonly sorter = new RenderSorter();
  readonly stats = new RendererStats();
  readonly batches: BatchBuilder;
  readonly instances: InstanceManager;
  submissionMode: "individual" | "sorted" | "instanced" = "instanced";
  cullingEnabled = true;
  readonly frustum = new Frustum();
  readonly culler: FrustumCuller;
  readonly bvh: BVH;
  readonly meshes: MeshManager;
  visibilityMode: "linear" | "bvh" = "linear";
  private bvhRevision = -1;
  readonly resources: Resources;
  readonly dynamic: DynamicBufferAllocator;
  readonly materialBuffer: GPUBuffer;
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
  readonly clearColor: GPUColor = { r: 0.04, g: 0.08, b: 0.14, a: 1 };

  constructor(
    readonly gpu: GPUContext,
    readonly world: RenderWorld,
    readonly materials: MaterialManager,
  ) {
    const device = gpu.device;
    this.resources = new Resources(device);
    this.meshes = new MeshManager(this.resources, gpu.queue);
    this.queue = new RenderQueue(world.capacity);
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
    this.vertexBuffer = this.resources.buffers.create({
      label: "Shared cube vertices",
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.indexBuffer = this.resources.buffers.create({
      label: "Shared cube indices",
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    gpu.queue.writeBuffer(this.vertexBuffer, 0, vertices);
    gpu.queue.writeBuffer(this.indexBuffer, 0, indices);
    this.meshes.register({
      vertex: this.vertexBuffer,
      index: this.indexBuffer,
      indexCount: 36,
      topology: 0,
    });
    this.dynamic = new DynamicBufferAllocator(
      this.resources.buffers,
      2 * 1024 * 1024,
      device.limits.minUniformBufferOffsetAlignment,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE,
    );
    this.frameBuffer = this.dynamic.buffers[0]!;
    const module = this.resources.shaders.get(shader, "Cube shader");
    this.materialBuffer = materials.createBuffer(this.resources.buffers);
    const groupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform", minBindingSize: 64 },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage", minBindingSize: 64 },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage", minBindingSize: 32 },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: "read-only-storage",
            hasDynamicOffset: true,
            minBindingSize: 32,
          },
        },
      ],
    });
    this.pipelineDescriptor = {
      label: "Cube pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [groupLayout] }),
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fs", targets: [{ format: gpu.format }] },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    };
    this.pipeline = this.resources.pipelines.get(this.pipelineDescriptor);
    this.pipelines = Array.from({ length: 18 }, (_, index) =>
      this.resources.pipelines.get({
        ...this.pipelineDescriptor,
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
          depthWriteEnabled: index < 12,
        },
        fragment: {
          ...this.pipelineDescriptor.fragment!,
          targets: [
            {
              format: gpu.format,
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
      }),
    );
    const alignment = this.dynamic.alignment;
    this.frameGroups = this.dynamic.buffers.map((buffer) =>
      device.createBindGroup({
        layout: groupLayout,
        entries: [
          { binding: 0, resource: { buffer, offset: 0, size: 64 } },
          {
            binding: 1,
            resource: { buffer, offset: alignment, size: world.capacity * 64 },
          },
          { binding: 2, resource: { buffer: this.materialBuffer } },
          {
            binding: 3,
            resource: { buffer, offset: 0, size: world.capacity * 32 },
          },
        ],
      }),
    );
    this.frameGroup = this.frameGroups[0]!;
    this.resize();
  }

  resize(): void {
    const { width, height } = this.gpu.canvas;
    if (width === this.width && height === this.height) return;
    if (this.depth) this.resources.textures.destroy(this.depth);
    this.width = width;
    this.height = height;
    this.depth = this.resources.textures.create({
      label: "Main depth",
      size: [width, height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depth.createView();
  }

  encode(encoder: GPUCommandEncoder, view: GPUTextureView): void {
    this.resize();
    this.camera.update(this.width / this.height);
    this.stats.reset();
    this.frustum.setFromMatrix(this.camera.viewProjection);
    if (
      this.visibilityMode === "bvh" &&
      this.bvhRevision !== this.world.staticRevision
    ) {
      this.bvh.build(this.world);
      this.bvhRevision = this.world.staticRevision;
    }
    const visible = this.cullingEnabled
      ? this.visibilityMode === "bvh"
        ? this.bvh.cull(this.world, this.frustum, this.culler)
        : this.culler.cull(this.world, this.frustum)
      : this.world.count;
    this.stats.totalRenderables = this.world.count;
    this.stats.frustumTested = this.cullingEnabled
      ? this.visibilityMode === "bvh"
        ? this.bvh.objectsTested
        : this.world.count
      : 0;
    this.stats.bvhNodesTested =
      this.cullingEnabled && this.visibilityMode === "bvh"
        ? this.bvh.nodesTested
        : 0;
    this.stats.visibleObjects = visible;
    this.stats.frustumRejected = this.world.count - visible;
    this.queue.build(
      this.world,
      this.materials,
      this.camera.view,
      this.cullingEnabled
        ? this.visibilityMode === "bvh"
          ? this.bvh.visible
          : this.culler.visible
        : undefined,
      visible,
    );
    for (let i = 0; i < this.world.count; i++)
      this.queue.pipeline[i] =
        this.materials.pipelineIndex(this.world.materialId[i]!) * 3 +
        this.meshes.get(this.world.meshId[i]!).topology;
    this.sorter.sort(
      this.queue,
      this.world,
      this.submissionMode !== "individual",
    );
    this.batches.build(
      this.queue,
      this.world,
      this.submissionMode === "instanced",
    );
    this.dynamic.beginFrame(this.frameNumber++);
    this.dynamic.write(this.dynamic.allocate(64), this.camera.viewProjection);
    this.dynamic.write(
      this.dynamic.allocate(Math.max(64, this.world.count * 64)),
      this.world.matrices.subarray(0, Math.max(16, this.world.count * 16)),
    );
    this.instances.update(this.queue, this.world);
    const instanceOffset = this.dynamic.allocate(
      Math.max(32, this.queue.count * 32),
      this.gpu.device.limits.minStorageBufferOffsetAlignment,
    );
    this.dynamic.write(
      instanceOffset,
      this.instances.data.subarray(0, Math.max(8, this.queue.count * 8)),
    );
    this.dynamic.flush(this.gpu.queue);
    this.materials.upload(this.gpu.queue, this.materialBuffer);
    this.stats.bufferUploadBytes =
      this.dynamic.uploadBytes + this.materials.uploadBytes;
    const pass = encoder.beginRenderPass({
      label: "Opaque cube",
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
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setBindGroup(0, this.frameGroups[this.dynamic.frameSlot]!, [
      instanceOffset,
    ]);
    let previousPipeline = -1,
      previousMaterial = -1,
      previousMesh = -1;
    for (let i = 0; i < this.batches.count; i++) {
      const mesh = this.batches.mesh[i]!,
        material = this.batches.material[i]!,
        pipeline = this.batches.pipeline[i]!,
        count = this.batches.instanceCount[i]!;
      const geometry = this.meshes.get(mesh);
      if (pipeline !== previousPipeline) {
        pass.setPipeline(this.pipelines[pipeline]!);
        previousPipeline = pipeline;
        this.stats.pipelineSwitches++;
      }
      if (material !== previousMaterial) {
        previousMaterial = material;
        this.stats.materialSwitches++;
      }
      if (mesh !== previousMesh) {
        previousMesh = mesh;
        this.stats.meshSwitches++;
        pass.setVertexBuffer(0, geometry.vertex);
        pass.setIndexBuffer(geometry.index, mesh === 0 ? "uint16" : "uint32");
      }
      pass.drawIndexed(
        geometry.indexCount,
        count,
        0,
        0,
        this.batches.firstInstance[i]!,
      );
      this.stats.drawCalls++;
      this.stats.instances += count;
      if (geometry.topology === 0)
        this.stats.triangles += (geometry.indexCount / 3) * count;
    }
    pass.end();
  }

  dispose(): void {
    this.resources.dispose();
  }
}
