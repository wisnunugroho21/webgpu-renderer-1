import type { ColorResources, ColorResourcesInput } from "./ColorResources";
import {
  MATERIAL_PIPELINE_VARIANTS,
  BLEND_PIPELINE_OFFSET,
  INDIRECT_VERTEX_OFFSET,
  COLOR_PIPELINE_COUNT,
} from "./ColorPipelineLayout";
import { MESH_VERTEX_LAYOUT } from "../geometry/VertexLayout";

/** Builds the bounded alpha/topology/depth/indirect table in the original cache/construction order. */
export function createColorPipelines(
  input: ColorResourcesInput,
  module: GPUShaderModule,
  groupLayout?: GPUBindGroupLayout,
): Pick<ColorResources, "pipelineDescriptor" | "pipeline" | "pipelines"> {
  const { gpu, textures, resources } = input;
  const device = gpu.device;
  const pipelineDescriptor: GPURenderPipelineDescriptor = {
    label: "Cube pipeline",
    layout:
      input.sharedBindings?.layout ??
      device.createPipelineLayout({
        bindGroupLayouts: [
          groupLayout!,
          textures.layout,
          ...(input.environmentLayout ? [input.environmentLayout] : []),
        ],
      }),
    vertex: {
      module,
      entryPoint: "vs",
      buffers: MESH_VERTEX_LAYOUT,
    },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: input.colorFormat ?? gpu.renderFormat }],
    },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  };
  const pipeline = resources.pipelines.get(pipelineDescriptor);
  // 18 material/topology variants × two depth modes × two vertex entry points.
  // This bounded table is built once; queue pipeline IDs index it directly each frame.
  const pipelines = Array.from(
    { length: COLOR_PIPELINE_COUNT },
    (_, variant) => {
      // Decode the stable queue index into topology, coverage and vertex entry point.

      const index = variant % MATERIAL_PIPELINE_VARIANTS;
      return resources.pipelines.get({
        ...pipelineDescriptor,
        vertex: {
          ...pipelineDescriptor.vertex,
          entryPoint: variant >= INDIRECT_VERTEX_OFFSET ? "vsIndirect" : "vs",
        },
        primitive: {
          ...pipelineDescriptor.primitive,
          topology:
            index % 3 === 0
              ? "triangle-list"
              : index % 3 === 1
                ? "line-list"
                : "point-list",
          cullMode:
            index % 3 !== 0 || Math.floor(index / 3) % 2 ? "none" : "back",
        },
        depthStencil: {
          ...pipelineDescriptor.depthStencil!,
          depthWriteEnabled:
            (variant >= INDIRECT_VERTEX_OFFSET ||
              variant % INDIRECT_VERTEX_OFFSET < MATERIAL_PIPELINE_VARIANTS) &&
            index < BLEND_PIPELINE_OFFSET,
          depthCompare:
            variant % INDIRECT_VERTEX_OFFSET < MATERIAL_PIPELINE_VARIANTS
              ? "less"
              : "less-equal",
        },
        fragment: {
          ...pipelineDescriptor.fragment!,
          targets: [
            {
              format: input.colorFormat ?? gpu.renderFormat,
              ...(index >= BLEND_PIPELINE_OFFSET
                ? {
                    blend: {
                      color: {
                        srcFactor: "src-alpha",
                        dstFactor: "one-minus-src-alpha",
                        operation: "add",
                      },
                      alpha: {
                        srcFactor: "one",
                        dstFactor: "one-minus-src-alpha",
                        operation: "add",
                      },
                    } as GPUBlendState,
                  }
                : {}),
            },
          ],
        },
      });
    },
  );
  return { pipelineDescriptor, pipeline, pipelines };
}
