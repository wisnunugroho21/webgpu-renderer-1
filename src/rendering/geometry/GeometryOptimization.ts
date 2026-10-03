import shader from "../../shaders/geometry-clusters.wgsl?raw";
import { Resources } from "../../gpu/Resources";
import { DynamicBufferAllocator } from "../../gpu/DynamicBufferAllocator";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";
import { MeshManager } from "../MeshManager";
import { BatchBuilder } from "../BatchBuilder";
import { RenderQueue } from "../RenderQueue";
import { RenderWorld } from "../RenderWorld";
/** Optional static-geometry cluster culling. GPU resources are created by the cold enabled setter. */
export class GeometryOptimization {
  readonly supported: boolean;
  readonly firstCluster: Uint32Array;
  readonly clusterCount: Uint32Array;
  readonly capacity: number;
  count = 0;
  uploadBytes = 0;
  fallbackBatches = 0;
  private staging = new Float32Array(0);
  private bits = new Uint32Array(0);
  get data(): Float32Array {
    return this.staging;
  }
  private readonly frame = new Float32Array(20);
  private readonly frameBits = new Uint32Array(this.frame.buffer);
  private active = false;
  private pipeline?: GPUComputePipeline;
  private groups: GPUBindGroup[] = [];
  private records?: GPUBuffer;
  private header?: GPUBuffer;
  arguments?: GPUBuffer;
  constructor(
    private readonly device: GPUDevice,
    private readonly resources: Resources,
    private readonly dynamic: DynamicBufferAllocator,
    objectCapacity: number,
    capacity = 65536,
  ) {
    if (
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      capacity > 65536 ||
      !Number.isSafeInteger(objectCapacity) ||
      objectCapacity < 1
    )
      throw new Error("Invalid geometry capacity");
    this.supported = device.features.has("indirect-first-instance");
    this.capacity = capacity;
    this.firstCluster = new Uint32Array(objectCapacity);
    this.clusterCount = new Uint32Array(objectCapacity);
  }
  get enabled(): boolean {
    return this.active;
  }
  set enabled(value: boolean) {
    if (value && this.supported && !this.pipeline) this.initialize();
    if (!value) this.clusterCount.fill(0);
    this.active = value;
  }
  private initialize(): void {
    this.staging = new Float32Array(this.capacity * 12);
    this.bits = new Uint32Array(this.staging.buffer);
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    this.records = this.resources.buffers.create({
      label: "Geometry cluster records",
      size: this.data.byteLength,
      usage: storage,
    });
    this.header = this.resources.buffers.create({
      label: "Geometry cluster frame",
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.arguments = this.resources.buffers.create({
      label: "Geometry cluster indirect arguments",
      size: this.capacity * 20,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.INDIRECT |
        GPUBufferUsage.COPY_SRC,
    });
    const layout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage", hasDynamicOffset: true },
        },
      ],
    });
    this.pipeline = this.device.createComputePipeline({
      label: "Static geometry cluster culling",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: {
        module: this.resources.shaders.get(shader, "Geometry clusters"),
        entryPoint: "cull",
      },
    });
    this.groups = this.dynamic.buffers.map((buffer) =>
      this.device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.header! } },
          { binding: 1, resource: { buffer: this.records! } },
          { binding: 2, resource: { buffer: this.arguments! } },
          {
            binding: 3,
            resource: {
              buffer,
              offset: this.dynamic.alignment,
              size: this.firstCluster.length * 64,
            },
          },
          {
            binding: 4,
            resource: {
              buffer,
              offset: 0,
              size: this.firstCluster.length * 48,
            },
          },
        ],
      }),
    );
  }
  prepare(
    batches: BatchBuilder,
    queue: RenderQueue,
    world: RenderWorld,
    meshes: MeshManager,
    vp: Float32Array,
    culling: boolean,
    indirect: boolean,
    gpuQueue: GPUQueue,
  ): void {
    this.count = this.uploadBytes = this.fallbackBatches = 0;
    if (!this.enabled) return;
    this.clusterCount.fill(0, 0, batches.count);
    let changedStart = this.capacity,
      changedEnd = 0;
    for (let b = 0; b < batches.count; b++) {
      const mesh = meshes.get(batches.mesh[b]!),
        clusters = mesh.clusters;
      let eligible =
        this.supported &&
        !indirect &&
        batches.pipeline[b]! < 12 &&
        mesh.topology === 0 &&
        !mesh.skin &&
        !mesh.morph &&
        !!clusters &&
        clusters.count > 1;
      const first = batches.firstInstance[b]!,
        instances = batches.instanceCount[b]!;
      for (let i = first; eligible && i < first + instances; i++) {
        const object = queue.order[i]!;
        if (world.jointCounts[object] || world.morphCounts[object])
          eligible = false;
      }
      if (
        !eligible ||
        this.count + clusters!.count * instances > this.capacity
      ) {
        this.fallbackBatches++;
        continue;
      }
      this.firstCluster[b] = this.count;
      this.clusterCount[b] = clusters!.count * instances;
      // Preserve original instance-major primitive ordering, including equal-depth surfaces.
      for (let instance = first; instance < first + instances; instance++)
        for (let c = 0; c < clusters!.count; c++) {
          const o = this.count++ * 12;
          for (let a = 0; a < 8; a++) {
            const value = clusters!.bounds[c * 8 + a]!;
            if (this.data[o + a] !== value) {
              changedStart = Math.min(changedStart, o / 12);
              changedEnd = this.count;
            }
            this.data[o + a] = value;
          }
          if (
            this.bits[o + 8] !== clusters!.indexCount[c] ||
            this.bits[o + 9] !== clusters!.firstIndex[c] ||
            this.bits[o + 10] !== 1 ||
            this.bits[o + 11] !== instance
          ) {
            changedStart = Math.min(changedStart, o / 12);
            changedEnd = this.count;
          }
          this.bits[o + 8] = clusters!.indexCount[c]!;
          this.bits[o + 9] = clusters!.firstIndex[c]!;
          this.bits[o + 10] = 1;
          this.bits[o + 11] = instance;
        }
    }
    if (!this.count) return;
    this.frame.set(vp);
    this.frameBits[16] = this.count;
    this.frameBits[17] = culling ? 1 : 0;
    gpuQueue.writeBuffer(this.header!, 0, this.frame);
    const changedBytes = Math.max(0, changedEnd - changedStart) * 48;
    if (changedBytes)
      gpuQueue.writeBuffer(
        this.records!,
        changedStart * 48,
        this.data.buffer,
        changedStart * 48,
        changedBytes,
      );
    this.uploadBytes = 80 + changedBytes;
  }
  encode(
    encoder: GPUCommandEncoder,
    slot: number,
    instanceOffset: number,
    profiler: GPUProfiler,
  ): void {
    if (!this.enabled || !this.count) return;
    const pass = encoder.beginComputePass({
      label: "Geometry cluster culling",
      timestampWrites: profiler.writes(GPUPass.geometry),
    });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, this.groups[slot]!, [instanceOffset]);
    pass.dispatchWorkgroups(Math.ceil(this.count / 64));
    pass.end();
  }
}
