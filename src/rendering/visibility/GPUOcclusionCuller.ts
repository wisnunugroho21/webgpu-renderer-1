import { Resources } from "../../gpu/Resources";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";
import { GPUFrustumCuller } from "./GPUFrustumCuller";
import frame from "../../shaders/frame.wgsl?raw";
import visibility from "../../shaders/visibility.wgsl?raw";
import shader from "../../shaders/gpu-occlusion.wgsl?raw";
/** Refines frustum flags with current-frame max-depth Hi-Z. Near-plane cases remain visible. */
export class GPUOcclusionCuller {
  enabled = false;
  dispatches = 0;
  private readonly layout: GPUBindGroupLayout;
  private readonly pipeline: GPUComputePipeline;
  private readonly groups: GPUBindGroup[] = [];
  private texture?: GPUTexture;
  constructor(
    private readonly device: GPUDevice,
    resources: Resources,
    private readonly frames: readonly GPUBuffer[],
    private readonly frustum: GPUFrustumCuller,
  ) {
    this.layout = device.createBindGroupLayout({
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
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
      ],
    });
    this.pipeline = resources.pipelines.getCompute({
      label: "Conservative GPU Hi-Z occlusion",
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      compute: {
        module: resources.shaders.get([frame, visibility, shader].join("\n")),
        entryPoint: "occlude",
      },
    });
  }
  resize(texture: GPUTexture): void {
    if (this.texture === texture) return;
    this.texture = texture;
    this.groups.length = 0;
    const view = texture.createView();
    for (const buffer of this.frames)
      this.groups.push(
        this.device.createBindGroup({
          layout: this.layout,
          entries: [
            { binding: 0, resource: { buffer, size: 192 } },
            { binding: 1, resource: { buffer: this.frustum.objects } },
            { binding: 2, resource: { buffer: this.frustum.visibility } },
            { binding: 3, resource: { buffer: this.frustum.params } },
            { binding: 4, resource: view },
          ],
        }),
      );
  }
  encode(
    encoder: GPUCommandEncoder,
    slot: number,
    profiler?: GPUProfiler,
  ): void {
    this.dispatches = 0;
    if (!this.enabled || !this.frustum.count) return;
    if (!this.texture)
      throw new Error("Initialize occlusion depth before dispatch");
    const pass = encoder.beginComputePass({
      label: "GPU occlusion culling",
      timestampWrites: profiler?.writes(GPUPass.occlusion),
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.groups[slot]!);
    pass.dispatchWorkgroups(Math.ceil(this.frustum.count / 64));
    pass.end();
    this.dispatches = 1;
  }
}
