import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";
import { Resources } from "../../gpu/Resources";
import { RenderWorld } from "../RenderWorld";
import frameShader from "../../shaders/frame.wgsl?raw";
import clusterShader from "../../shaders/clusters.wgsl?raw";
/** Fixed shared storage; viewport tiling grows coarser before exhausting capacity.
 * List overflow is signaled by the true count and falls back to the full light loop.
 */
export class ClusteredLighting {
  readonly counts: GPUBuffer;
  readonly indices: GPUBuffer;
  readonly capacity = 32768;
  readonly maxLights = 64;
  readonly slices = 24;
  tilesX = 1;
  tilesY = 1;
  tileSize = 64;
  mode: "auto" | "off" | "on" = "auto";
  active = false;
  private readonly pipeline: GPUComputePipeline;
  private readonly frames: GPUBindGroup[];
  private readonly output: GPUBindGroup;
  constructor(
    device: GPUDevice,
    resources: Resources,
    buffers: readonly GPUBuffer[],
    lights: GPUBuffer,
    width: number,
    height: number,
  ) {
    this.counts = resources.buffers.create({
      label: "Cluster light counts",
      size: this.capacity * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.indices = resources.buffers.create({
      label: "Cluster light indices",
      size: this.capacity * this.maxLights * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    const frameLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", minBindingSize: 192 },
        },
        {
          binding: 9,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage", minBindingSize: 64 },
        },
      ],
    });
    const outputLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });
    const module = resources.shaders.get(
      frameShader + "\n" + clusterShader,
      "Cluster light assignment",
    );
    this.pipeline = resources.pipelines.getCompute({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [frameLayout, outputLayout],
      }),
      compute: { module, entryPoint: "cs" },
    });
    this.frames = buffers.map((buffer) =>
      device.createBindGroup({
        layout: frameLayout,
        entries: [
          { binding: 0, resource: { buffer, offset: 0, size: 192 } },
          { binding: 9, resource: { buffer: lights } },
        ],
      }),
    );
    this.output = device.createBindGroup({
      layout: outputLayout,
      entries: [
        { binding: 0, resource: { buffer: this.counts } },
        { binding: 1, resource: { buffer: this.indices } },
      ],
    });
    this.resize(width, height);
  }
  resize(width: number, height: number): void {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1
    )
      throw new Error("Invalid cluster viewport");
    this.tileSize = 64;
    do {
      this.tilesX = Math.ceil(width / this.tileSize);
      this.tilesY = Math.ceil(height / this.tileSize);
      if (this.tilesX * this.tilesY * this.slices <= this.capacity) break;
      this.tileSize *= 2;
    } while (this.tilesX * this.tilesY * this.slices > this.capacity);
  }
  choose(world: RenderWorld): boolean {
    if (this.mode === "off" || !world.lightCount) return (this.active = false);
    let bounded = 0;
    for (let i = 0; i < world.lightCount; i++)
      if (world.lightData[i * 16 + 11]! > 0 && world.lightData[i * 16 + 3]! > 0)
        bounded++;
    return (this.active =
      this.mode === "on" ||
      (world.lightCount >= 32 && bounded >= world.lightCount / 2));
  }
  encode(
    encoder: GPUCommandEncoder,
    slot: number,
    profiler?: GPUProfiler,
  ): void {
    if (!this.active) return;
    const pass = encoder.beginComputePass({
      timestampWrites: profiler?.writes(GPUPass.clusters),
      label: "Cluster light lists",
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.frames[slot]!);
    pass.setBindGroup(1, this.output);
    pass.dispatchWorkgroups(this.tilesX, this.tilesY, this.slices);
    pass.end();
  }
}
