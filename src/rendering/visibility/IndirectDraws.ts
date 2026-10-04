import { Resources } from "../../gpu/Resources";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";
import { RenderWorld } from "../RenderWorld";
import { RenderQueue } from "../RenderQueue";
import { BatchBuilder } from "../BatchBuilder";
import { MeshManager } from "../MeshManager";
import { MaterialManager } from "../materials/MaterialManager";
import { VisibilityCompactor } from "./VisibilityCompactor";
import { GPULODSelector } from "../lod/GPULODSelector";
import shader from "../../shaders/indirect.wgsl?raw";
/** CPU describes possible batches; GPU chooses LOD, instance ranges and indexed arguments. */
export class IndirectDraws {
  enabled = false;
  readonly supported: boolean;
  readonly batches: BatchBuilder;
  readonly arguments: GPUBuffer;
  readonly visibleRecords: GPUBuffer;
  readonly metadata: GPUBuffer;
  readonly mapping: GPUBuffer;
  readonly params: GPUBuffer;
  readonly data: Uint32Array;
  readonly objectData: Uint32Array;
  private readonly previousData: Uint32Array;
  private readonly previousObjects: Uint32Array;
  private readonly parameterData = new Uint32Array(4);
  private readonly group: GPUBindGroup;
  private readonly initializePipeline: GPUComputePipeline;
  private readonly appendPipeline: GPUComputePipeline;
  private objects = -1;
  private batchCount = -1;
  uploadBytes = 0;
  /** Initializes candidate batch metadata, visible records and indexed indirect arguments. */
  constructor(
    device: GPUDevice,
    resources: Resources,
    readonly capacity: number,
    compactor: VisibilityCompactor,
    private readonly lod: GPULODSelector,
  ) {
    this.supported = device.features.has("indirect-first-instance");
    this.batches = new BatchBuilder(capacity * 8);
    this.data = new Uint32Array(capacity * 64);
    this.objectData = new Uint32Array(capacity * 12);
    this.previousData = new Uint32Array(this.data.length);
    this.previousObjects = new Uint32Array(this.objectData.length);
    /** Delegates this operation to resources.buffers.create. */
    const create = (label: string, size: number, usage: number) =>
      resources.buffers.create({ label, size: Math.max(4, size), usage });
    this.arguments = create(
      "GPU indexed indirect arguments",
      capacity * 8 * 20,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.INDIRECT |
        GPUBufferUsage.COPY_SRC,
    );
    this.visibleRecords = create(
      "GPU visible instance records",
      capacity * 8 * 16,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    this.metadata = create(
      "Shared indirect LOD batch metadata",
      capacity * 8 * 32,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    this.mapping = create(
      "Object to LOD draws mapping",
      capacity * 48,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    this.params = create(
      "Indirect draw counts",
      16,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const layout = device.createBindGroupLayout({
      entries: Array.from(
        { length: 8 },
        (
          _,
          binding,
        ) => /** Builds a record containing binding, visibility, buffer. */ ({
          binding,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type:
              binding === 0
                ? ("uniform" as const)
                : binding === 5 || binding === 6
                  ? ("storage" as const)
                  : ("read-only-storage" as const),
            minBindingSize:
              binding === 0 || binding === 3 || binding === 6
                ? 16
                : binding === 1
                  ? 32
                  : binding === 2
                    ? 48
                    : binding === 5
                      ? 20
                      : 4,
          },
        }),
      ),
    });
    this.group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: this.metadata } },
        { binding: 2, resource: { buffer: this.mapping } },
        { binding: 3, resource: { buffer: compactor.counter } },
        { binding: 4, resource: { buffer: compactor.visibleInstances } },
        { binding: 5, resource: { buffer: this.arguments } },
        { binding: 6, resource: { buffer: this.visibleRecords } },
        { binding: 7, resource: { buffer: lod.selections } },
      ],
    });
    const module = resources.shaders.get(shader),
      pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [layout],
      });
    this.initializePipeline = resources.pipelines.getCompute({
      label: "Initialize GPU draw arguments",
      layout: pipelineLayout,
      compute: { module, entryPoint: "initialize" },
    });
    this.appendPipeline = resources.pipelines.getCompute({
      label: "Build GPU indexed draw arguments",
      layout: pipelineLayout,
      compute: { module, entryPoint: "buildArguments" },
    });
  }
  /** Builds candidate batch/LOD mappings while retaining transparent rank ordering and selected deformation layouts. */
  prepare(
    world: RenderWorld,
    queue: RenderQueue,
    sourceBatches: BatchBuilder,
    meshes: MeshManager,
    materials: MaterialManager,
    gpu: GPUQueue,
  ): void {
    this.uploadBytes = 0;
    if (!this.enabled) return;
    if (!this.supported)
      throw new Error("GPU indirect mode requires indirect-first-instance");
    if (world.count > this.capacity || sourceBatches.count > this.capacity)
      throw new Error("Indirect capacity exceeded");
    this.objectData.fill(0xffffffff, 0, world.count * 12);
    this.batches.count = 0;
    let firstInstance = 0;
    for (let source = 0; source < sourceBatches.count; source++) {
      const first = sourceBatches.firstInstance[source]!,
        count = sourceBatches.instanceCount[source]!,
        object = queue.order[first]!,
        groupId = world.lodGroup[object]!,
        group = groupId >= 0 ? this.lod.registry.entries[groupId] : undefined,
        levels = group?.meshes.length ?? 1,
        material = sourceBatches.material[source]!,
        firstBatch = this.batches.count;
      for (let level = 0; level < levels; level++) {
        const batch = this.batches.count++,
          meshId = group?.meshes[level] ?? sourceBatches.mesh[source]!,
          mesh = meshes.get(meshId),
          o = batch * 8;
        this.batches.firstInstance[batch] = firstInstance;
        this.batches.instanceCount[batch] = count;
        this.batches.mesh[batch] = meshId;
        this.batches.material[batch] = material;
        this.batches.pipeline[batch] =
          materials.pipelineIndex(material) * 3 + mesh.topology;
        this.data[o] = mesh.indexCount;
        this.data[o + 1] = count;
        this.data[o + 2] = firstInstance;
        this.data[o + 3] = materials.alphaMode[material] === 2 ? 1 : 0;
        this.data[o + 4] = mesh.morphOffset ?? 0;
        this.data[o + 5] =
          mesh.deformationVertexCount ?? mesh.morph?.vertexCount ?? 0;
        this.data[o + 6] = meshId;
        this.data[o + 7] = 0;
        firstInstance += count;
      }
      for (let i = first; i < first + count; i++) {
        const o = queue.order[i]! * 12;
        this.objectData[o] = i;
        this.objectData[o + 1] = i - first;
        this.objectData[o + 2] = this.objectData[o + 3] = 0;
        for (let level = 0; level < levels; level++)
          this.objectData[o + 4 + level] = firstBatch + level;
      }
    }
    if (
      this.batches.count > this.capacity * 8 ||
      firstInstance > this.capacity * 8
    )
      throw new Error("GPU LOD batch capacity exceeded");
    this.upload(
      this.metadata,
      this.data,
      this.previousData,
      this.batches.count * 8,
      this.batchCount !== this.batches.count,
      gpu,
    );
    this.upload(
      this.mapping,
      this.objectData,
      this.previousObjects,
      world.count * 12,
      this.objects !== world.count,
      gpu,
    );
    if (
      this.objects !== world.count ||
      this.batchCount !== this.batches.count
    ) {
      this.parameterData[0] = world.count;
      this.parameterData[1] = this.batches.count;
      gpu.writeBuffer(this.params, 0, this.parameterData);
      this.uploadBytes += 16;
    }
    this.objects = world.count;
    this.batchCount = this.batches.count;
  }
  /** Transfers changed candidate batch metadata, visible records and indexed indirect arguments into its existing shared GPU storage. */
  private upload(
    buffer: GPUBuffer,
    input: Uint32Array,
    previous: Uint32Array,
    count: number,
    force: boolean,
    queue: GPUQueue,
  ): void {
    let first = Infinity,
      last = 0;
    for (let i = 0; i < count; i++)
      if (force || input[i] !== previous[i]) {
        previous[i] = input[i]!;
        first = Math.min(first, i);
        last = i + 1;
      }
    if (first !== Infinity) {
      queue.writeBuffer(
        buffer,
        first * 4,
        input.buffer,
        first * 4,
        (last - first) * 4,
      );
      this.uploadBytes += (last - first) * 4;
    }
  }
  /** Initializes indexed arguments and appends compacted visible objects without CPU visibility readback. */
  encode(encoder: GPUCommandEncoder, profiler?: GPUProfiler): void {
    if (!this.enabled || this.objects <= 0 || this.batchCount <= 0) return;
    const initialize = encoder.beginComputePass({
      label: "Indirect arguments initialization",
      timestampWrites: profiler?.writes(GPUPass.indirect),
    });
    initialize.setPipeline(this.initializePipeline);
    initialize.setBindGroup(0, this.group);
    initialize.dispatchWorkgroups(
      Math.ceil(Math.max(this.objects, this.batchCount) / 64),
    );
    initialize.end();
    const append = encoder.beginComputePass({
      label: "GPU indirect visible instances",
      timestampWrites: profiler?.writes(GPUPass.indirect),
    });
    append.setPipeline(this.appendPipeline);
    append.setBindGroup(0, this.group);
    append.dispatchWorkgroups(Math.ceil(this.objects / 64));
    append.end();
  }
}
