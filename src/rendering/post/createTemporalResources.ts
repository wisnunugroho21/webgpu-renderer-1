import {
  MOTION_OBJECT_WORDS,
  MOTION_FRAME_BYTES,
  TEMPORAL_SETTINGS_BYTES,
} from "./TemporalLayout";
import type { Renderer } from "../Renderer";
import { MotionHistory } from "./MotionHistory";
import { createMotionShader } from "./createMotionShader";
import { MESH_VERTEX_LAYOUT } from "../geometry/VertexLayout";
import resolveShader from "../../shaders/temporal-resolve.wgsl?raw";

/** Cold motion/resolve construction in dependency order; shared Resources retains GPU destruction ownership. */
export function createTemporalResources(renderer: Renderer) {
  const device = renderer.gpu.device,
    resources = renderer.resources,
    world = renderer.world;
  const history = new MotionHistory(
    world.capacity,
    world.jointCapacity,
    world.morphCapacity,
  );
  const create = (size: number, label: string) => {
    // All pose buffers are shared fixed pools, never one allocation per actor.
    return resources.buffers.create({
      size: Math.max(16, size),
      label,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  };
  const uploadedCurrent = new Uint32Array(world.capacity * MOTION_OBJECT_WORDS);
  const uploadedPrevious = new Uint32Array(
    world.capacity * MOTION_OBJECT_WORDS,
  );
  const current = create(history.current.byteLength, "Current motion objects");
  const previous = create(history.previous.byteLength, "Previous motion pose");
  const frameBuffer = resources.buffers.create({
    size: MOTION_FRAME_BYTES,
    label: "Motion frame",
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const settingsBuffer = resources.buffers.create({
    size: TEMPORAL_SETTINGS_BYTES,
    label: "Temporal resolve controls",
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const entries: GPUBindGroupLayoutEntry[] = [];
  for (let binding = 0; binding < 8; binding++)
    entries.push({
      binding,
      visibility:
        binding === 2 ? GPUShaderStage.FRAGMENT : GPUShaderStage.VERTEX,
      buffer: { type: binding === 0 ? "uniform" : "read-only-storage" },
    });
  const layout = device.createBindGroupLayout({ entries });
  const buffers = [
    frameBuffer,
    current,
    renderer.materialBuffer,
    previous,
    renderer.joints.buffer,
    renderer.morphWeights.buffer,
    renderer.morphDeltas.position,
    renderer.morphDeltas.tangent,
  ];
  const motionGroup = device.createBindGroup({
    layout,
    entries: buffers.map((buffer, binding) => {
      // Bind retained current arenas and a single packed previous arena.
      return { binding, resource: { buffer } };
    }),
  });
  const module = resources.shaders.get(createMotionShader(), "Temporal motion");
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [layout, renderer.textures.layout],
  });
  const pipelines: GPURenderPipeline[] = [];
  for (const doubleSided of [false, true])
    for (const topology of [
      "triangle-list",
      "line-list",
      "point-list",
    ] as const)
      pipelines.push(
        resources.pipelines.get({
          label: "Temporal motion",
          layout: pipelineLayout,
          vertex: { module, entryPoint: "vs", buffers: MESH_VERTEX_LAYOUT },
          fragment: {
            module,
            entryPoint: "fs",
            targets: [{ format: "rgba32float" }],
          },
          primitive: { topology, cullMode: doubleSided ? "none" : "back" },
          depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: false,
            depthCompare: "less-equal",
          },
        }),
      );
  const resolveLayout = device.createBindGroupLayout({
    entries: Array.from({ length: 7 }, (_, binding) => {
      // Explicit unfilterable layouts support exact float history/depth texture loads.
      return binding === 6
        ? {
            binding,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" as const },
          }
        : {
            binding,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {
              sampleType:
                binding === 3
                  ? ("depth" as const)
                  : ("unfilterable-float" as const),
            },
          };
    }),
  });
  const resolve = resources.shaders.get(resolveShader, "Temporal resolve");
  const resolvePipeline = resources.pipelines.get({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [resolveLayout],
    }),
    vertex: { module: resolve, entryPoint: "vs" },
    fragment: {
      module: resolve,
      entryPoint: "fs",
      targets: [{ format: "rgba16float" }, { format: "r32float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  return {
    history,
    uploadedCurrent,
    uploadedPrevious,
    current,
    previous,
    frameBuffer,
    settingsBuffer,
    motionGroup,
    resolveLayout,
    resolvePipeline,
    pipelines,
  };
}
