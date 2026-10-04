import {
  MATERIAL_PIPELINE_VARIANTS,
  BLEND_PIPELINE_OFFSET,
  INDIRECT_VERTEX_OFFSET,
  COLOR_PIPELINE_COUNT,
} from "./ColorPipelineLayout";
import {
  FRAME_BYTES,
  MATRIX_BYTES,
  INSTANCE_BYTES,
  MATERIAL_BYTES,
  LIGHT_BYTES,
  SHADOW_BYTES,
} from "../layouts";
import { GPUContext } from "../../gpu/GPUContext";
import { RenderWorld } from "../RenderWorld";
import { Resources } from "../../gpu/Resources";
import { DynamicBufferAllocator } from "../../gpu/DynamicBufferAllocator";
import { MaterialTextures } from "../materials/MaterialTextures";
import { JointMatrixBuffer } from "../JointMatrixBuffer";
import { MorphWeightBuffer } from "../MorphWeightBuffer";
import { MorphDeltaBuffers } from "../MorphDeltaBuffers";
import { LightBuffer } from "../LightBuffer";
import { ClusteredLighting } from "../lighting/ClusteredLighting";
import { ShadowManager } from "../shadows/ShadowManager";
import { IndirectDraws } from "../visibility/IndirectDraws";
import { MESH_VERTEX_LAYOUT } from "../geometry/VertexLayout";
import environmentShader from "../../shaders/environment.wgsl?raw";
import shadowShader from "../../shaders/shadows.wgsl?raw";
import geometryShader from "../../shaders/geometry.wgsl?raw";
import frameShader from "../../shaders/frame.wgsl?raw";
import lightingShader from "../../shaders/lighting.wgsl?raw";
import pbrShader from "../../shaders/pbr.wgsl?raw";
import commonShader from "../../shaders/common.wgsl?raw";
import morphShader from "../../shaders/morphing.wgsl?raw";
import skinShader from "../../shaders/skinning.wgsl?raw";

const defaultAmbient = `
// Returns a 3% diffuse ambient term attenuated by AO when no environment is installed.
fn ambientLighting(base: vec3<f32>, metallic: f32, roughness: f32, n: vec3<f32>, v: vec3<f32>, ao: f32) -> vec3<f32> {
  return base * (1.0 - metallic) * 0.03 * ao;
}`;
const sharedShader = [
  frameShader,
  geometryShader,
  commonShader,
  morphShader,
  skinShader,
  shadowShader,
  lightingShader,
  pbrShader,
].join("\n");
export interface ColorResourcesInput {
  environmentLayout?: GPUBindGroupLayout;
  colorFormat?: GPUTextureFormat;
  gpu: GPUContext;
  world: RenderWorld;
  resources: Resources;
  dynamic: DynamicBufferAllocator;
  materialBuffer: GPUBuffer;
  textures: MaterialTextures;
  joints: JointMatrixBuffer;
  morphWeights: MorphWeightBuffer;
  morphDeltas: MorphDeltaBuffers;
  lights: LightBuffer;
  clusters: ClusteredLighting;
  shadows: ShadowManager;
  gpuDraws: IndirectDraws;
}
/** Cold setup only: prepare bounded pipeline variants and one bind group per arena slot.
 * The frame loop retains these objects and changes only dynamic instance offsets. */
export function createColorResources(input: ColorResourcesInput) {
  const {
    gpu,
    world,
    resources,
    dynamic,
    materialBuffer,
    textures,
    joints,
    morphWeights,
    morphDeltas,
    lights,
    clusters,
    shadows,
    gpuDraws,
  } = input;
  const device = gpu.device;
  const module = resources.shaders.get(
    sharedShader +
      "\n" +
      (input.environmentLayout ? environmentShader : defaultAmbient),
    "PBR shader",
  );
  const groupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", minBindingSize: FRAME_BYTES },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage", minBindingSize: MATRIX_BYTES },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage", minBindingSize: MATERIAL_BYTES },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: "read-only-storage",
          hasDynamicOffset: true,
          minBindingSize: INSTANCE_BYTES,
        },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage", minBindingSize: MATRIX_BYTES },
      },
      ...[5, 6, 7, 8].map(
        (
          binding,
        ) => /** Builds a record containing binding, visibility, buffer. */ ({
          binding,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: "read-only-storage" as const,
            minBindingSize: binding === 5 ? 4 : 16,
          },
        }),
      ),
      {
        binding: 9,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage", minBindingSize: LIGHT_BYTES },
      },
      ...[10, 11].map(
        (
          binding,
        ) => /** Builds a record containing binding, visibility, buffer. */ ({
          binding,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: {
            type: "read-only-storage" as const,
            minBindingSize: binding === 10 ? 8 : 4,
          },
        }),
      ),
      {
        binding: 12,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage", minBindingSize: SHADOW_BYTES },
      },
      {
        binding: 13,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "depth", viewDimension: "2d-array" },
      },
      {
        binding: 15,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage", minBindingSize: 16 },
      },
      {
        binding: 14,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "comparison" },
      },
    ],
  });
  const pipelineDescriptor: GPURenderPipelineDescriptor = {
    label: "Cube pipeline",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [
        groupLayout,
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
      // Returns the keyed entry from resources pipelines.

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
  const alignment = dynamic.alignment;
  const frameGroups = dynamic.buffers.map((buffer) =>
    /** Delegates this operation to device.createBindGroup. */ device.createBindGroup(
      {
        layout: groupLayout,
        entries: [
          { binding: 0, resource: { buffer, offset: 0, size: FRAME_BYTES } },
          {
            binding: 1,
            resource: {
              buffer,
              offset: alignment,
              size: world.capacity * MATRIX_BYTES,
            },
          },
          { binding: 2, resource: { buffer: materialBuffer } },
          { binding: 4, resource: { buffer: joints.buffer } },
          { binding: 5, resource: { buffer: morphWeights.buffer } },
          { binding: 6, resource: { buffer: morphDeltas.position } },
          { binding: 7, resource: { buffer: morphDeltas.normal } },
          { binding: 8, resource: { buffer: morphDeltas.tangent } },
          { binding: 9, resource: { buffer: lights.buffer } },
          { binding: 10, resource: { buffer: clusters.counts } },
          { binding: 11, resource: { buffer: clusters.indices } },
          { binding: 12, resource: { buffer: shadows.buffer } },
          { binding: 13, resource: shadows.view },
          { binding: 14, resource: shadows.sampler },
          { binding: 15, resource: { buffer: gpuDraws.visibleRecords } },
          {
            binding: 3,
            resource: {
              buffer,
              offset: 0,
              size: world.capacity * INSTANCE_BYTES,
            },
          },
        ],
      },
    ),
  );

  return { pipelineDescriptor, pipeline, pipelines, frameGroups };
}
