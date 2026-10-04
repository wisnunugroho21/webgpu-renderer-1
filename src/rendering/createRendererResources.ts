import { createBootstrapMesh } from "./geometry/createBootstrapMesh";
import { MESH_VERTEX_LAYOUT } from "./geometry/VertexLayout";
import { GeometryOptimization } from "./geometry/GeometryOptimization";
import { TemporalVisibility } from "./visibility/TemporalVisibility";
import { GPULODSelector } from "./lod/GPULODSelector";
import { IndirectDraws } from "./visibility/IndirectDraws";
import { VisibilityCompactor } from "./visibility/VisibilityCompactor";
import { GPUOcclusionCuller } from "./visibility/GPUOcclusionCuller";
import { GPUFrustumCuller } from "./visibility/GPUFrustumCuller";
import { HiZPyramid } from "./visibility/HiZPyramid";
import { DepthPrepass } from "./DepthPrepass";
import { GPUProfiler } from "../profiling/GPUProfiler";
import { ShadowManager } from "./shadows/ShadowManager";
import { ClusteredLighting } from "./lighting/ClusteredLighting";
import { LightBuffer } from "./LightBuffer";
import { LODGroups } from "./lod/LODGroups";
import { MorphDeltaBuffers } from "./MorphDeltaBuffers";
import { MorphWeightBuffer } from "./MorphWeightBuffer";
import { JointMatrixBuffer } from "./JointMatrixBuffer";
import { GPUContext } from "../gpu/GPUContext";
import { Resources } from "../gpu/Resources";
import { DynamicBufferAllocator } from "../gpu/DynamicBufferAllocator";
import { RenderWorld } from "./RenderWorld";
import { MaterialManager } from "./materials/MaterialManager";
import { MeshManager } from "./MeshManager";
import { MaterialTextures } from "./materials/MaterialTextures";

/** Cold renderer construction in dependency order. Resources owns every returned GPU allocation.
 * Public Renderer aliases preserve identity; steady frame paths never call this factory. */
export function createRendererResources(
  gpu: GPUContext,
  world: RenderWorld,
  materials: MaterialManager,
  lodGroups: LODGroups,
) {
  const device = gpu.device;
  const resources = new Resources(device);
  const temporal = new TemporalVisibility(world);
  const previousVisibility = resources.buffers.create({
    label: "Previous visibility",
    size: Math.max(4, world.capacity * 4),
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const gpuProfiler = new GPUProfiler(device, resources);
  const hiz = new HiZPyramid(device, resources, gpu.renderFormat);
  const lights = new LightBuffer(resources.buffers, world.lightCapacity);
  const joints = new JointMatrixBuffer(resources.buffers, world.jointCapacity);
  const textures = new MaterialTextures(device, resources);
  const morphDeltas = new MorphDeltaBuffers(resources, gpu.queue);
  const morphWeights = new MorphWeightBuffer(
    resources.buffers,
    world.morphCapacity,
  );
  const meshes = new MeshManager(resources, gpu.queue, morphDeltas);
  const bootstrapMesh = createBootstrapMesh(meshes);
  const vertexBuffer = meshes.get(bootstrapMesh).vertex;
  const indexBuffer = meshes.get(bootstrapMesh).index;
  const dynamic = new DynamicBufferAllocator(
    resources.buffers,
    4 * 1024 * 1024,
    device.limits.minUniformBufferOffsetAlignment,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE,
  );
  const frameBuffer = dynamic.buffers[0]!;
  const gpuFrustum = new GPUFrustumCuller(
    device,
    resources,
    dynamic.buffers,
    world.capacity,
  );
  const gpuOcclusion = new GPUOcclusionCuller(
    device,
    resources,
    dynamic.buffers,
    gpuFrustum,
  );
  const gpuCompaction = new VisibilityCompactor(device, resources, gpuFrustum);
  const gpuLOD = new GPULODSelector(
    device,
    resources,
    dynamic.buffers,
    gpuFrustum,
    lodGroups,
  );
  const gpuDraws = new IndirectDraws(
    device,
    resources,
    world.capacity,
    gpuCompaction,
    gpuLOD,
  );
  const clusters = new ClusteredLighting(
    device,
    resources,
    dynamic.buffers,
    lights.buffer,
    gpu.canvas.width,
    gpu.canvas.height,
  );
  const materialBuffer = materials.createBuffer(resources.buffers);
  const shadows = new ShadowManager(
    device,
    resources,
    dynamic,
    world,
    [
      frameBuffer,
      frameBuffer,
      materialBuffer,
      frameBuffer,
      joints.buffer,
      morphWeights.buffer,
      morphDeltas.position,
      morphDeltas.normal,
      morphDeltas.tangent,
    ],
    meshes,
    materials,
    textures,
    MESH_VERTEX_LAYOUT,
  );
  const depthPrepass = new DepthPrepass(
    resources,
    shadows,
    meshes,
    materials,
    textures,
  );
  const geometryOptimization = new GeometryOptimization(
    device,
    resources,
    dynamic,
    world.capacity,
  );
  // Default-on where supported; prepare once during cold renderer construction.
  geometryOptimization.enabled = geometryOptimization.supported;
  return {
    resources,
    temporal,
    previousVisibility,
    gpuProfiler,
    hiz,
    lights,
    joints,
    textures,
    morphDeltas,
    morphWeights,
    meshes,
    vertexBuffer,
    indexBuffer,
    dynamic,
    frameBuffer,
    gpuFrustum,
    gpuOcclusion,
    gpuCompaction,
    gpuLOD,
    gpuDraws,
    clusters,
    materialBuffer,
    shadows,
    depthPrepass,
    geometryOptimization,
  };
}
