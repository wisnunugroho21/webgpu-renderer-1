import type { Resources } from "../../gpu/Resources";
import type { DynamicBufferAllocator } from "../../gpu/DynamicBufferAllocator";
import type { RenderWorld } from "../RenderWorld";
import type { MaterialTextures } from "../materials/MaterialTextures";
import frame from "../../shaders/frame.wgsl?raw";
import geometry from "../../shaders/geometry.wgsl?raw";
import common from "../../shaders/common.wgsl?raw";
import morph from "../../shaders/morphing.wgsl?raw";
import skin from "../../shaders/skinning.wgsl?raw";
import shader from "../../shaders/shadow-pass.wgsl?raw";

/** Borrowed setup dependencies and fixed target dimensions; no owner is transferred. */
export interface ShadowResourcesInput {
  device: GPUDevice;
  resources: Resources;
  dynamic: DynamicBufferAllocator;
  world: RenderWorld;
  bindings: readonly GPUBuffer[];
  textures: MaterialTextures;
  vertexBuffers: GPUVertexBufferLayout[];
  resolution: number;
  capacity: number;
  dataBytes: number;
}

/** Prepare fixed shadow targets, shared bindings and six topology/culling variants.
 * Called only during renderer construction; Resources retains allocation ownership.
 * Keep creation order and binding offsets consistent with the shared deformation ABI. */
export function createShadowResources({
  device,
  resources,
  dynamic,
  world,
  bindings,
  textures,
  vertexBuffers,
  resolution,
  capacity,
  dataBytes,
}: ShadowResourcesInput) {
  const texture = resources.textures.create({
    label: "Directional shadow array",
    size: [resolution, resolution, capacity],
    format: "depth32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView({ dimension: "2d-array" });
  const views = Array.from({ length: capacity }, (_, layer) =>
    /** Isolate one array layer as the writable cascade attachment. */ texture.createView(
      {
        dimension: "2d",
        baseArrayLayer: layer,
        arrayLayerCount: 1,
      },
    ),
  );
  const sampler = resources.samplers.get({
    compare: "less-equal",
    magFilter: "linear",
    minFilter: "linear",
  });
  const buffer = resources.buffers.create({
    label: "Shared shadow matrices",
    size: dataBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  // Exclude the sampled shadow texture from depth-pass groups to avoid feedback hazards.
  const layout = device.createBindGroupLayout({
    entries: Array.from(
      { length: 9 },
      (
        _,
        binding,
      ) => /** Material alpha is fragment data; all other slots feed shared vertex deformation. */ ({
        binding,
        visibility:
          binding === 2 ? GPUShaderStage.FRAGMENT : GPUShaderStage.VERTEX,
        buffer: {
          type:
            binding === 0
              ? ("uniform" as const)
              : ("read-only-storage" as const),
          minBindingSize:
            binding === 0
              ? 192
              : binding === 2
                ? 80
                : binding === 3
                  ? 48
                  : binding === 5
                    ? 4
                    : binding >= 6
                      ? 16
                      : 64,
          hasDynamicOffset: binding === 3,
        },
      }),
    ),
  });
  const groups = dynamic.buffers.map((buffer) =>
    /** Delegates this operation to device.createBindGroup. */ device.createBindGroup(
      {
        layout,
        entries: Array.from(
          { length: 9 },
          (
            _,
            binding,
          ) => /** Alias the shared frame arena and static deformation buffers at their ABI offsets. */ ({
            binding,
            resource:
              binding === 0
                ? { buffer, offset: 0, size: 192 }
                : binding === 1
                  ? {
                      buffer,
                      offset: dynamic.alignment,
                      size: world.capacity * 64,
                    }
                  : binding === 3
                    ? { buffer, offset: 0, size: world.capacity * 48 }
                    : { buffer: bindings[binding]! },
          }),
        ),
      },
    ),
  );
  const passLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: 64,
        },
      },
    ],
  });
  const passGroups = dynamic.buffers.map((buffer) =>
    /** Delegates this operation to device.createBindGroup. */ device.createBindGroup(
      {
        layout: passLayout,
        entries: [{ binding: 0, resource: { buffer, size: 64 } }],
      },
    ),
  );
  const module = resources.shaders.get(
    [frame, geometry, common, morph, skin, shader].join("\n"),
    "Shared deformed shadow shader",
  );
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [layout, textures.layout, passLayout],
  });
  const descriptors: GPURenderPipelineDescriptor[] = Array.from(
    { length: 6 },
    (
      _,
      index,
    ) => /** Pair triangle/line/point variants with single- and double-sided material policy. */ ({
      label: "Shadow depth",
      layout: pipelineLayout,
      vertex: { module, entryPoint: "shadowVS", buffers: vertexBuffers },
      fragment: { module, entryPoint: "shadowFS", targets: [] },
      primitive: {
        topology:
          index % 3 === 0
            ? "triangle-list"
            : index % 3 === 1
              ? "line-list"
              : "point-list",
        cullMode: index % 3 !== 0 || index >= 3 ? "none" : "back",
      },
      depthStencil: {
        format: "depth32float",
        depthCompare: "less",
        depthWriteEnabled: true,
        depthBias: index % 3 === 0 ? 2 : 0,
        depthBiasSlopeScale: index % 3 === 0 ? 2 : 0,
      },
    }),
  );
  const pipelines = descriptors.map((descriptor) =>
    /** Reuse the resource cache while preparing every supported caster variant. */ resources.pipelines.get(
      descriptor,
    ),
  );
  return {
    texture,
    view,
    views,
    sampler,
    buffer,
    groups,
    passGroups,
    descriptors,
    pipelines,
  };
}
