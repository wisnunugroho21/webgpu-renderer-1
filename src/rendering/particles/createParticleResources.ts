import type { GPUContext } from "../../gpu/GPUContext";
import type { Resources } from "../../gpu/Resources";
import {
  PARTICLE_BYTES,
  PARTICLE_FRAME_BYTES,
} from "../../particles/ParticleLayout";
import shader from "../../shaders/particles.wgsl?raw";

/** Cold enable/recovery setup for three shared buffers and four billboard variants.
 * Returns borrowed GPU identities: the renderer's Resources owner destroys storage.
 * Normal frames must only upload and encode against these retained objects. */
export function createParticleResources(
  gpu: GPUContext,
  resources: Resources,
  recordBytes: number,
  orderBytes: number,
) {
  const { device } = gpu;
  const direct: GPURenderPipeline[] = [];
  const hdr: GPURenderPipeline[] = [];
  const module = resources.shaders.get(shader, "Analytic particles");
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage", minBindingSize: PARTICLE_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage", minBindingSize: 4 },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "uniform", minBindingSize: PARTICLE_FRAME_BYTES },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [layout],
  });
  for (const format of [gpu.renderFormat, "rgba16float"] as const) {
    const pipelines = format === gpu.renderFormat ? direct : hdr;
    for (let additive = 0; additive < 2; additive++)
      pipelines.push(
        resources.pipelines.get({
          label: "Particle billboards",
          layout: pipelineLayout,
          vertex: { module, entryPoint: "vs" },
          fragment: {
            module,
            entryPoint: "fs",
            targets: [
              {
                format,
                blend: {
                  color: {
                    srcFactor: "one",
                    dstFactor: additive ? "one" : "one-minus-src-alpha",
                    operation: "add",
                  },
                  alpha: {
                    srcFactor: additive ? "zero" : "one",
                    dstFactor: additive ? "one" : "one-minus-src-alpha",
                    operation: "add",
                  },
                },
              },
            ],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: false,
            depthCompare: "less-equal",
          },
        }),
      );
  }
  const buffer = resources.buffers.create({
    label: "Shared particle records",
    size: recordBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const orderBuffer = resources.buffers.create({
    label: "Shared particle order",
    size: orderBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const frameBuffer = resources.buffers.create({
    label: "Particle camera and clock",
    size: PARTICLE_FRAME_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const group = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer } },
      { binding: 1, resource: { buffer: orderBuffer } },
      { binding: 2, resource: { buffer: frameBuffer } },
    ],
  });
  return { buffer, orderBuffer, frameBuffer, group, direct, hdr };
}
