import type { ColorResourcesInput } from "./ColorResources";
import {
  FRAME_BYTES,
  MATRIX_BYTES,
  INSTANCE_BYTES,
  MATERIAL_BYTES,
  LIGHT_BYTES,
  SHADOW_BYTES,
} from "../layouts";
import { MATERIAL_SHADER_PARAMETER_BYTES } from "../materials/MaterialShaderRegistry";

/** Creates the shared geometry/material layout once; compatible custom families reuse its owner. */
export function createColorBindGroupLayout(
  input: ColorResourcesInput,
): GPUBindGroupLayout | undefined {
  const device = input.gpu.device;
  return input.sharedBindings
    ? undefined
    : device.createBindGroupLayout({
        entries: [
          ...(input.transmission
            ? [
                {
                  binding: 18,
                  visibility: GPUShaderStage.FRAGMENT,
                  texture: { sampleType: "float" as const },
                },
                {
                  binding: 19,
                  visibility: GPUShaderStage.FRAGMENT,
                  sampler: { type: "filtering" as const },
                },
              ]
            : []),
          ...(input.shader
            ? [
                {
                  binding: 16,
                  visibility: GPUShaderStage.FRAGMENT,
                  buffer: {
                    type: "read-only-storage" as const,
                    minBindingSize: MATERIAL_SHADER_PARAMETER_BYTES,
                  },
                },
              ]
            : []),
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
            buffer: {
              type: "read-only-storage",
              minBindingSize: MATERIAL_BYTES,
            },
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
            (binding) => /** Declare the existing shared storage binding. */ ({
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
            (binding) => /** Declare the existing shared storage binding. */ ({
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
}

/** Binds the preallocated arena slots and shared owners without creating per-object groups. */
export function createColorFrameGroups(
  input: ColorResourcesInput,
  groupLayout?: GPUBindGroupLayout,
): GPUBindGroup[] {
  const {
    gpu,
    world,
    dynamic,
    materialBuffer,
    joints,
    morphWeights,
    morphDeltas,
    lights,
    clusters,
    shadows,
    gpuDraws,
  } = input;
  const device = gpu.device;
  const alignment = dynamic.alignment;
  return (
    input.sharedBindings?.frameGroups ??
    dynamic.buffers.map((buffer) =>
      /** Keep one immutable group per arena buffer; instances use dynamic offsets. */ device.createBindGroup(
        {
          layout: groupLayout!,
          entries: [
            ...(input.transmission
              ? [
                  { binding: 18, resource: input.transmission.background },
                  { binding: 19, resource: input.transmission.sampler },
                ]
              : []),
            ...(input.shader
              ? [
                  {
                    binding: 16,
                    resource: { buffer: input.shaderParameterBuffer! },
                  },
                ]
              : []),
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
    )
  );
}
