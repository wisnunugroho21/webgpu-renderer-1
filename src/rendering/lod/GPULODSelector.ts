import { Resources } from "../../gpu/Resources";
import { RenderWorld } from "../RenderWorld";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";
import { GPUFrustumCuller } from "../visibility/GPUFrustumCuller";
import { LODGroups } from "./LODGroups";
import frame from "../../shaders/frame.wgsl?raw";
import visibility from "../../shaders/visibility.wgsl?raw";
import shader from "../../shaders/gpu-lod.wgsl?raw";
/** GPU projected size, entity-keyed hysteresis and tiny-object rejection after visibility. */
export class GPULODSelector {
  enabled = false;
  readonly selections: GPUBuffer;
  readonly selectedMeshes: GPUBuffer;
  readonly distribution: GPUBuffer;
  readonly objectBuffer: GPUBuffer;
  readonly groupBuffer: GPUBuffer;
  readonly history: GPUBuffer;
  private readonly objectData: Uint32Array;
  private readonly previousObjects: Uint32Array;
  private readonly groupData = new Float32Array(1024 * 20);
  private readonly groupIds = new Uint32Array(this.groupData.buffer);
  private readonly previousGroups = new Uint32Array(1024 * 20);
  private readonly groups: GPUBindGroup[];
  private readonly pipeline: GPUComputePipeline;
  private objectCount = -1;
  private groupCount = -1;
  uploadBytes = 0;
  constructor(
    device: GPUDevice,
    resources: Resources,
    frames: readonly GPUBuffer[],
    private readonly frustum: GPUFrustumCuller,
    readonly registry: LODGroups,
  ) {
    const create = (label: string, size: number, usage: number) =>
      resources.buffers.create({ label, size: Math.max(4, size), usage });
    this.objectData = new Uint32Array(frustum.capacity * 4);
    this.previousObjects = new Uint32Array(frustum.capacity * 4);
    this.objectBuffer = create(
      "GPU LOD object metadata",
      frustum.capacity * 16,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    this.groupBuffer = create(
      "GPU authored LOD groups",
      1024 * 80,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    this.history = create(
      "GPU entity LOD history",
      frustum.capacity * 16,
      GPUBufferUsage.STORAGE,
    );
    this.selections = create(
      "GPU LOD selections",
      frustum.capacity * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    this.selectedMeshes = create(
      "GPU selected mesh IDs",
      frustum.capacity * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    this.distribution = create(
      "GPU LOD distribution",
      32,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    );
    const layout = device.createBindGroupLayout({
      entries: Array.from({ length: 10 }, (_, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type:
            binding === 0 || binding === 3
              ? ("uniform" as const)
              : binding === 2 || binding >= 6
                ? ("storage" as const)
                : ("read-only-storage" as const),
          minBindingSize:
            binding === 0
              ? 192
              : binding === 1
                ? 32
                : binding === 3 || binding === 4 || binding === 6
                  ? 16
                  : binding === 5
                    ? 80
                    : binding === 9
                      ? 32
                      : 4,
        },
      })),
    });
    this.groups = frames.map((buffer) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer, size: 192 } },
          { binding: 1, resource: { buffer: frustum.objects } },
          { binding: 2, resource: { buffer: frustum.visibility } },
          { binding: 3, resource: { buffer: frustum.params } },
          { binding: 4, resource: { buffer: this.objectBuffer } },
          { binding: 5, resource: { buffer: this.groupBuffer } },
          { binding: 6, resource: { buffer: this.history } },
          { binding: 7, resource: { buffer: this.selections } },
          { binding: 8, resource: { buffer: this.selectedMeshes } },
          { binding: 9, resource: { buffer: this.distribution } },
        ],
      }),
    );
    this.pipeline = resources.pipelines.getCompute({
      label: "GPU projected LOD",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: {
        module: resources.shaders.get([frame, visibility, shader].join("\n")),
        entryPoint: "selectLOD",
      },
    });
  }
  prepare(world: RenderWorld, queue: GPUQueue): void {
    this.uploadBytes = 0;
    if (!this.enabled) return;
    if (this.registry.entries.length > 1024)
      throw new Error("GPU LOD group capacity exceeded");
    for (let i = 0; i < world.count; i++) {
      const o = i * 4,
        group = world.lodGroup[i]!,
        entity = world.entityId[i]!;
      if (entity >= this.frustum.capacity)
        throw new Error("GPU LOD entity capacity exceeded");
      if (group >= 0 && !this.registry.entries[group])
        throw new Error("Unknown GPU LOD group");
      this.objectData[o] = group;
      this.objectData[o + 1] = entity;
      this.objectData[o + 2] =
        group >= 0
          ? this.registry.entries[group]!.meshes[0]!
          : world.meshId[i]!;
      this.objectData[o + 3] = 0;
    }
    for (let i = 0; i < this.registry.entries.length; i++) {
      const group = this.registry.entries[i]!,
        o = i * 20;
      this.groupIds[o] = group.meshes.length;
      this.groupData[o + 1] = group.hysteresis;
      for (let l = 0; l < group.meshes.length; l++) {
        this.groupData[o + 4 + l] = group.thresholds[l]!;
        this.groupIds[o + 12 + l] = group.meshes[l]!;
      }
    }
    this.upload(
      this.objectBuffer,
      this.objectData,
      this.previousObjects,
      world.count * 4,
      this.objectCount !== world.count,
      queue,
    );
    this.upload(
      this.groupBuffer,
      this.groupIds,
      this.previousGroups,
      this.registry.entries.length * 20,
      this.groupCount !== this.registry.entries.length,
      queue,
    );
    this.objectCount = world.count;
    this.groupCount = this.registry.entries.length;
  }
  private upload(
    buffer: GPUBuffer,
    data: Uint32Array,
    previous: Uint32Array,
    count: number,
    force: boolean,
    queue: GPUQueue,
  ): void {
    let first = Infinity,
      last = 0;
    for (let i = 0; i < count; i++)
      if (force || previous[i] !== data[i]) {
        previous[i] = data[i]!;
        first = Math.min(first, i);
        last = i + 1;
      }
    if (first !== Infinity) {
      queue.writeBuffer(
        buffer,
        first * 4,
        data.buffer,
        first * 4,
        (last - first) * 4,
      );
      this.uploadBytes += (last - first) * 4;
    }
  }
  encode(
    encoder: GPUCommandEncoder,
    slot: number,
    profiler?: GPUProfiler,
  ): void {
    if (!this.enabled) return;
    encoder.clearBuffer(this.distribution);
    if (!this.frustum.count) return;
    const pass = encoder.beginComputePass({
      label: "GPU screen size and LOD",
      timestampWrites: profiler?.writes(GPUPass.lod),
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.groups[slot]!);
    pass.dispatchWorkgroups(Math.ceil(this.frustum.count / 64));
    pass.end();
  }
}
