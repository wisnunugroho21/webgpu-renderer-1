import { GPUContext } from "../../gpu/GPUContext";
import { Resources } from "../../gpu/Resources";
import { Mat4 } from "../../math/Mat4";
import { Camera } from "../Camera";
import shader from "../../shaders/skybox.wgsl?raw";
/** Draws the environment behind geometry, in the same linear target as scene shading. */
export class EnvironmentSkybox {
  private active = false;
  private buffer?: GPUBuffer;
  private group?: GPUBindGroup;
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private readonly inverse = Mat4.create();
  constructor(
    private readonly gpu: GPUContext,
    private readonly resources: Resources,
    private readonly environmentLayout: () => GPUBindGroupLayout | undefined,
  ) {}
  get enabled(): boolean {
    return this.active;
  }
  set enabled(value: boolean) {
    if (value) {
      const layout = this.environmentLayout();
      if (layout) this.prepare(layout);
    }
    this.active = value;
  }
  prepare(environmentLayout: GPUBindGroupLayout): void {
    if (!this.active && this.pipelines.size) return;
    if (this.buffer) return;
    const device = this.gpu.device;
    this.buffer = this.resources.buffers.create({
      label: "Skybox inverse projection",
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const frame = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: 64 },
        },
      ],
    });
    this.group = device.createBindGroup({
      layout: frame,
      entries: [{ binding: 0, resource: { buffer: this.buffer } }],
    });
    const module = this.resources.shaders.get(shader, "Environment skybox"),
      layout = device.createPipelineLayout({
        bindGroupLayouts: [frame, environmentLayout],
      });
    for (const format of [
      this.gpu.renderFormat,
      "rgba16float",
    ] as GPUTextureFormat[])
      this.pipelines.set(
        format,
        this.resources.pipelines.get({
          label: "Environment skybox",
          layout,
          vertex: { module, entryPoint: "vs" },
          fragment: { module, entryPoint: "fs", targets: [{ format }] },
          primitive: { topology: "triangle-list" },
          depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: false,
            depthCompare: "less-equal",
          },
        }),
      );
  }
  update(camera: Camera): void {
    if (!this.active || !this.buffer) return;
    Mat4.invert(this.inverse, camera.viewProjection);
    this.gpu.queue.writeBuffer(this.buffer, 0, this.inverse);
  }
  encode(
    pass: GPURenderPassEncoder,
    environment: GPUBindGroup | undefined,
    format: GPUTextureFormat,
  ): void {
    if (!this.active || !environment || !this.group) return;
    pass.setPipeline(this.pipelines.get(format)!);
    pass.setBindGroup(0, this.group);
    pass.setBindGroup(1, environment);
    pass.draw(3);
  }
}
