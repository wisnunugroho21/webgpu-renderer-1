import { Resources } from "../../gpu/Resources";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";
import { GPUFrustumCuller } from "./GPUFrustumCuller";
import shader from "../../shaders/visibility-compact.wgsl?raw";
/** Initial atomic append. Output order is intentionally unspecified; capacity covers all candidates. */
export class VisibilityCompactor {
  enabled = false;
  readonly visibleInstances: GPUBuffer;
  readonly counter: GPUBuffer;
  private readonly group: GPUBindGroup;
  private readonly pipeline: GPUComputePipeline;
  dispatches = 0;
  /** Initializes GPU visible-index compaction and bounded counters. */
  constructor(
    device: GPUDevice,
    resources: Resources,
    private readonly frustum: GPUFrustumCuller,
  ) {
    this.visibleInstances = resources.buffers.create({
      label: "VisibleInstanceBuffer",
      size: Math.max(4, frustum.capacity * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.counter = resources.buffers.create({
      label: "GPU visible count",
      size: 16,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", minBindingSize: 16 },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage", minBindingSize: 4 },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage", minBindingSize: 4 },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage", minBindingSize: 16 },
        },
      ],
    });
    this.group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: frustum.params } },
        { binding: 1, resource: { buffer: frustum.visibility } },
        { binding: 2, resource: { buffer: this.visibleInstances } },
        { binding: 3, resource: { buffer: this.counter } },
      ],
    });
    this.pipeline = resources.pipelines.getCompute({
      label: "Atomic visible instance append",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: resources.shaders.get(shader), entryPoint: "compact" },
    });
  }
  /** Resets counters and compacts visible object indices into a bounded GPU list. */
  encode(encoder: GPUCommandEncoder, profiler?: GPUProfiler): void {
    this.dispatches = 0;
    if (!this.enabled) return;
    encoder.clearBuffer(this.counter);
    if (!this.frustum.count) return;
    const pass = encoder.beginComputePass({
      label: "Visible instance compaction",
      timestampWrites: profiler?.writes(GPUPass.compaction),
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.dispatchWorkgroups(Math.ceil(this.frustum.count / 64));
    pass.end();
    this.dispatches = 1;
  }
}
