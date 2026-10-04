import type { ColorResources, ColorResourcesInput } from "./ColorResources";
import { colorShaderSource } from "./colorShaderSource";
import {
  createColorBindGroupLayout,
  createColorFrameGroups,
} from "./createColorBindings";
import { createColorPipelines } from "./createColorPipelines";
export type { ColorResources, ColorResourcesInput } from "./ColorResources";
export { colorShaderSource } from "./colorShaderSource";

/** Cold setup only: preserve shader, layout, pipeline and frame-group construction order.
 * Frames retain these objects and only change dynamic instance offsets. */
export function createColorResources(
  input: ColorResourcesInput,
): ColorResources {
  const module = input.resources.shaders.get(
    colorShaderSource(input),
    input.shader?.name ?? "PBR shader",
  );
  const groupLayout = createColorBindGroupLayout(input);
  const { pipelineDescriptor, pipeline, pipelines } = createColorPipelines(
    input,
    module,
    groupLayout,
  );
  const frameGroups = createColorFrameGroups(input, groupLayout);
  return {
    pipelineDescriptor,
    pipeline,
    pipelines,
    frameGroups,
    bindings: {
      layout: pipelineDescriptor.layout as GPUPipelineLayout,
      frameGroups,
    },
  };
}
