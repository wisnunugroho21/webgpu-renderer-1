import visibilityShader from "../../shaders/visibility.wgsl?raw";
import { Resources } from "../../gpu/Resources";
import { RenderWorld } from "../RenderWorld";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";
import frameShader from "../../shaders/frame.wgsl?raw";
import shader from "../../shaders/gpu-frustum.wgsl?raw";
/** Shared 32-byte object records and one invocation per object; no CPU visibility readback. */
export class GPUFrustumCuller {
  enabled = false;
  readonly objects: GPUBuffer;
  readonly visibility: GPUBuffer;
  readonly params: GPUBuffer;
  readonly data: Float32Array;
  readonly ids: Uint32Array;
  private readonly parameterData = new Uint32Array(4);
  private readonly groups: GPUBindGroup[];
  private readonly pipeline: GPUComputePipeline;
  count = 0;
  uploadBytes = 0;
  dispatches = 0;
  constructor(
    device: GPUDevice,
    private readonly resources: Resources,
    frames: readonly GPUBuffer[],
    readonly capacity: number,
  ) {
    this.data = new Float32Array(capacity * 8);
    this.ids = new Uint32Array(this.data.buffer);
    this.objects = resources.buffers.create({
      label: "GPU object records",
      size: Math.max(32, capacity * 32),
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    this.visibility = resources.buffers.create({
      label: "GPU visibility flags",
      size: Math.max(4, capacity * 4),
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    this.params = resources.buffers.create({
      label: "GPU visibility parameters",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", minBindingSize: 192 },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage", minBindingSize: 32 },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage", minBindingSize: 4 },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", minBindingSize: 16 },
        },
      ],
    });
    this.groups = frames.map((buffer) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer, size: 192 } },
          { binding: 1, resource: { buffer: this.objects } },
          { binding: 2, resource: { buffer: this.visibility } },
          { binding: 3, resource: { buffer: this.params } },
        ],
      }),
    );
    this.pipeline = resources.pipelines.getCompute({
      label: "GPU sphere frustum",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: {
        module: resources.shaders.get(
          frameShader + "\n" + visibilityShader + "\n" + shader,
        ),
        entryPoint: "cull",
      },
    });
  }
  update(world: RenderWorld, queue: GPUQueue): void {
    this.uploadBytes = 0;
    if (!this.enabled) return;
    if (world.count > this.capacity)
      throw new Error("GPU visibility capacity exceeded");
    const previous = this.count;
    this.count = world.count;
    let first = Infinity,
      last = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 8;
      let changed = i >= previous;
      for (let k = 0; k < 4; k++)
        if (this.data[o + k] !== world.sphere[i * 4 + k]) {
          this.data[o + k] = world.sphere[i * 4 + k]!;
          changed = true;
        }
      const mesh = world.meshId[i]!,
        material = world.materialId[i]!,
        transform = world.transformIndex[i]!,
        flags = world.flags[i]!;
      if (
        this.ids[o + 4] !== mesh ||
        this.ids[o + 5] !== material ||
        this.ids[o + 6] !== transform ||
        this.ids[o + 7] !== flags
      ) {
        this.ids[o + 4] = mesh;
        this.ids[o + 5] = material;
        this.ids[o + 6] = transform;
        this.ids[o + 7] = flags;
        changed = true;
      }
      if (changed) {
        first = Math.min(first, i);
        last = i + 1;
      }
    }
    if (first !== Infinity) {
      queue.writeBuffer(
        this.objects,
        first * 32,
        this.data.buffer,
        first * 32,
        (last - first) * 32,
      );
      this.uploadBytes += (last - first) * 32;
    }
    if (this.parameterData[0] !== this.count || previous === 0) {
      this.parameterData[0] = this.count;
      queue.writeBuffer(this.params, 0, this.parameterData);
      this.uploadBytes += 16;
    }
  }
  encode(
    encoder: GPUCommandEncoder,
    slot: number,
    profiler?: GPUProfiler,
  ): void {
    this.dispatches = 0;
    if (!this.enabled || !this.count) return;
    const pass = encoder.beginComputePass({
      label: "GPU frustum culling",
      timestampWrites: profiler?.writes(GPUPass.visibility),
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.groups[slot]!);
    pass.dispatchWorkgroups(Math.ceil(this.count / 64));
    pass.end();
    this.dispatches = 1;
  }
  dispose(): void {
    this.resources.buffers.destroy(this.objects);
    this.resources.buffers.destroy(this.visibility);
    this.resources.buffers.destroy(this.params);
  }
}
