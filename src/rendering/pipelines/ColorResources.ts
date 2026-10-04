import type { RegisteredMaterialShader } from "../materials/MaterialShaderRegistry";
import type { GPUContext } from "../../gpu/GPUContext";
import type { RenderWorld } from "../RenderWorld";
import type { Resources } from "../../gpu/Resources";
import type { DynamicBufferAllocator } from "../../gpu/DynamicBufferAllocator";
import type { MaterialTextures } from "../materials/MaterialTextures";
import type { JointMatrixBuffer } from "../JointMatrixBuffer";
import type { MorphWeightBuffer } from "../MorphWeightBuffer";
import type { MorphDeltaBuffers } from "../MorphDeltaBuffers";
import type { LightBuffer } from "../LightBuffer";
import type { ClusteredLighting } from "../lighting/ClusteredLighting";
import type { ShadowManager } from "../shadows/ShadowManager";
import type { IndirectDraws } from "../visibility/IndirectDraws";

/** Cold setup dependencies; no gameplay-world queries are exposed to a render pass. */
export interface ColorResourcesInput {
  /** Compatible custom families share their immutable layout and frame bind groups. */
  sharedBindings?: { layout: GPUPipelineLayout; frameGroups: GPUBindGroup[] };
  shader?: RegisteredMaterialShader;
  shaderParameterBuffer?: GPUBuffer;
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
/** Retained pipeline/binding identities shared by every frame and compatible shader families. */
export interface ColorResources {
  pipelineDescriptor: GPURenderPipelineDescriptor;
  pipeline: GPURenderPipeline;
  pipelines: GPURenderPipeline[];
  frameGroups: GPUBindGroup[];
  bindings: { layout: GPUPipelineLayout; frameGroups: GPUBindGroup[] };
}
