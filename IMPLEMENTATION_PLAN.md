# Efficient WebGPU Renderer — Implementation Plan

## 1. Objective

Build a production-oriented **WebGPU renderer in TypeScript** designed for:

- efficient GPU resource usage;
- low CPU submission overhead;
- scalable scene management;
- data-oriented ECS;
- glTF 2.0 / GLB assets;
- PBR materials;
- skeletal animation;
- GPU skinning;
- morph targets;
- instancing;
- frustum and occlusion culling;
- level of detail;
- clustered lighting;
- shadows;
- render graphs;
- asynchronous asset loading;
- GPU-driven rendering;
- indirect drawing;
- profiling and benchmarking.

The renderer should start as a conventional CPU-driven renderer and evolve toward:

```text
ECS
 ↓
Render Extraction
 ↓
Render World
 ↓
GPU Object Data
 ↓
Compute Visibility
 ├─ Frustum Culling
 ├─ LOD
 └─ Hi-Z Occlusion
 ↓
Visible Instances
 ↓
Indirect Draw Arguments
 ↓
Render Graph
 ↓
WebGPU
```

---

## 2. Core Design Principles

### 2.1 Reuse Resources

Normal frame rendering should mostly reuse:

```text
GPUBuffer
GPUTexture
GPUSampler
GPUBindGroup
GPURenderPipeline
GPUComputePipeline
```

Avoid resource construction in the steady-state frame loop.

### 2.2 Separate Gameplay From Rendering

Use:

```text
Gameplay / ECS
       ↓
Render Extraction
       ↓
Render World
       ↓
Renderer
```

The renderer should not traverse arbitrary gameplay objects.

### 2.3 Use Data-Oriented Storage

Prefer compact arrays and typed arrays over large JavaScript object graphs.

Example:

```text
positionX[]
positionY[]
positionZ[]

rotationX[]
rotationY[]
rotationZ[]
rotationW[]

scaleX[]
scaleY[]
scaleZ[]
```

This makes CPU iteration and GPU upload easier.

### 2.4 Minimize CPU-GPU Synchronization

Prefer:

```text
CPU prepares commands
        ↓
GPU executes asynchronously
```

Avoid frequent:

```text
GPU → CPU readback
mapAsync()
waiting for GPU completion
```

inside normal frame processing.

### 2.5 Optimize Based on Measurements

Every optimization must have:

```text
baseline
 ↓
implementation
 ↓
benchmark
 ↓
comparison
```

Do not add complexity merely because a technique is theoretically faster.

---

## 3. Technology Stack

Use:

```text
Language:
TypeScript

Graphics API:
WebGPU

Shaders:
WGSL

Assets:
glTF 2.0 / GLB

Build Tool:
Vite

Testing:
Vitest

Profiling:
performance.now()
WebGPU timestamp queries where supported
```

Potential future asset technologies:

```text
KTX2
Basis Universal
Draco
Meshopt
```

---

## 4. Target Architecture

```text
Application
│
├── ECS World
│   ├── Entity Manager
│   ├── Transform Store
│   ├── Mesh Renderer Store
│   ├── Bounds Store
│   ├── Animation Store
│   ├── Skin Store
│   ├── Morph Store
│   ├── Light Store
│   └── Camera Store
│
├── Simulation Systems
│   ├── Transform System
│   ├── Animation System
│   ├── Skeleton System
│   ├── Morph System
│   ├── Bounds System
│   └── Visibility System
│
├── Render Extraction
│
├── Render World
│   ├── Render Objects
│   ├── Instance Data
│   ├── Material Data
│   ├── Light Data
│   ├── Joint Data
│   └── Morph Data
│
├── Resource Managers
│   ├── Buffer Manager
│   ├── Texture Manager
│   ├── Sampler Cache
│   ├── Shader Manager
│   ├── Pipeline Cache
│   ├── Material Manager
│   └── Mesh Manager
│
├── Visibility
│   ├── Frustum Culling
│   ├── BVH
│   ├── LOD
│   ├── Hi-Z
│   └── GPU Culling
│
├── Renderer
│   ├── Render Queues
│   ├── Batch Builder
│   ├── Instance Manager
│   ├── Render Graph
│   └── Render Passes
│
└── Profiling
```

---

## 5. Suggested Project Structure

```text
src/
│
├── app/
│   └── Application.ts
│
├── core/
│   ├── Handle.ts
│   ├── ObjectPool.ts
│   └── BitSet.ts
│
├── math/
│   ├── Vec2.ts
│   ├── Vec3.ts
│   ├── Vec4.ts
│   ├── Quat.ts
│   ├── Mat4.ts
│   ├── AABB.ts
│   ├── BoundingSphere.ts
│   └── Frustum.ts
│
├── gpu/
│   ├── GPUContext.ts
│   ├── GPUCapabilities.ts
│   ├── BufferManager.ts
│   ├── DynamicBufferAllocator.ts
│   ├── TextureManager.ts
│   ├── SamplerCache.ts
│   ├── ShaderManager.ts
│   ├── PipelineCache.ts
│   └── BindGroupCache.ts
│
├── ecs/
│   ├── Entity.ts
│   ├── World.ts
│   ├── Query.ts
│   │
│   ├── components/
│   │   ├── TransformStore.ts
│   │   ├── MeshRendererStore.ts
│   │   ├── BoundsStore.ts
│   │   ├── AnimatorStore.ts
│   │   ├── SkinStore.ts
│   │   ├── MorphStore.ts
│   │   ├── LightStore.ts
│   │   └── CameraStore.ts
│   │
│   └── systems/
│       ├── TransformSystem.ts
│       ├── AnimationSystem.ts
│       ├── SkeletonSystem.ts
│       ├── MorphSystem.ts
│       ├── BoundsSystem.ts
│       └── VisibilitySystem.ts
│
├── assets/
│   ├── AssetManager.ts
│   ├── ImageLoader.ts
│   └── gltf/
│       ├── GLTFLoader.ts
│       ├── GLTFParser.ts
│       ├── GLTFMeshLoader.ts
│       ├── GLTFMaterialLoader.ts
│       ├── GLTFTextureLoader.ts
│       ├── GLTFAnimationLoader.ts
│       ├── GLTFSkinLoader.ts
│       └── GLTFMorphLoader.ts
│
├── animation/
│   ├── AnimationClip.ts
│   ├── AnimationChannel.ts
│   ├── AnimationSampler.ts
│   ├── Animator.ts
│   ├── Skeleton.ts
│   ├── SkeletonInstance.ts
│   └── MorphState.ts
│
├── rendering/
│   ├── Renderer.ts
│   ├── RenderWorld.ts
│   ├── RenderObject.ts
│   ├── RenderExtractor.ts
│   ├── RenderQueue.ts
│   ├── RenderSorter.ts
│   ├── BatchBuilder.ts
│   ├── InstanceManager.ts
│   │
│   ├── materials/
│   │   ├── Material.ts
│   │   ├── MaterialManager.ts
│   │   └── MaterialFlags.ts
│   │
│   ├── passes/
│   │   ├── ShadowPass.ts
│   │   ├── DepthPass.ts
│   │   ├── OpaquePass.ts
│   │   ├── TransparentPass.ts
│   │   └── PostProcessPass.ts
│   │
│   └── graph/
│       ├── RenderGraph.ts
│       ├── RenderPassNode.ts
│       └── RenderResource.ts
│
├── visibility/
│   ├── FrustumCuller.ts
│   ├── BVH.ts
│   ├── LODSystem.ts
│   ├── HiZ.ts
│   └── GPUCulling.ts
│
├── lighting/
│   ├── LightManager.ts
│   ├── ClusterBuilder.ts
│   └── ShadowManager.ts
│
├── profiling/
│   ├── RendererStats.ts
│   ├── CPUProfiler.ts
│   └── GPUProfiler.ts
│
├── shaders/
│   ├── common.wgsl
│   ├── morphing.wgsl
│   ├── skinning.wgsl
│   ├── depth.wgsl
│   ├── pbr.wgsl
│   ├── hiz.wgsl
│   └── culling.wgsl
│
└── main.ts
```

---

## 6. Phase 1 — Project Bootstrap

### Goal

Create the minimum stable WebGPU application.

Implement:

```text
Vite
TypeScript
Vitest
canvas
WebGPU initialization
resize handling
device-loss handling
frame loop
```

Create:

```ts
class GPUContext {
    adapter: GPUAdapter;
    device: GPUDevice;
    queue: GPUQueue;
    context: GPUCanvasContext;
    format: GPUTextureFormat;
}
```

### Acceptance Criteria

- WebGPU initializes.
- Canvas clears correctly.
- Canvas resizes correctly.
- Device-loss Promise is handled.
- No WebGPU validation errors.

---

## 7. Phase 2 — Basic Renderer

Implement:

```text
command encoder
render pass
swap-chain texture
depth texture
render pipeline
WGSL vertex/fragment shader
```

Render:

```text
indexed cube
```

Support:

```text
depth testing
back-face culling
perspective camera
```

### Acceptance Criteria

One indexed 3D object renders correctly.

---

## 8. Phase 3 — Math and Camera

Implement:

```text
Vec3
Quat
Mat4
AABB
BoundingSphere
Frustum
```

Add:

```text
view matrix
projection matrix
viewProjection
camera position
```

Create persistent frame uniform buffer.

### Acceptance Criteria

Camera moves correctly without reallocating GPU buffers.

---

## 9. Phase 4 — GPU Resource Management

Implement:

```text
ShaderManager
PipelineCache
SamplerCache
BufferManager
TextureManager
```

Pipeline key should contain:

```text
shader
vertex layout
topology
cull mode
depth state
blend state
render target format
sample count
```

### Rule

No `createRenderPipeline()` during steady-state rendering.

### Metrics

Track:

```text
pipeline creations
shader modules
buffers
textures
samplers
cache hits
cache misses
```

---

## 10. Phase 5 — Efficient Dynamic Buffers

Implement:

```text
DynamicBufferAllocator
```

Use:

```text
ring buffering
or
triple buffering
```

Store:

```text
camera data
object transforms
material data
instance data
```

Avoid:

```text
one buffer per object
```

### Acceptance Criteria

Thousands of objects must not create thousands of buffers.

---

## 11. Phase 6 — Data-Oriented ECS

Implement numeric entities.

```ts
type Entity = number;
```

Core stores:

```text
Transform
MeshRenderer
Bounds
Animator
Skin
Morph
Light
Camera
```

Transform store:

```text
positionX[]
positionY[]
positionZ[]

rotationX[]
rotationY[]
rotationZ[]
rotationW[]

scaleX[]
scaleY[]
scaleZ[]

worldMatrices[]
parent[]
dirty[]
```

### Dirty Transform System

Only update:

```text
changed transform
+
affected descendants
```

### Benchmark

Test:

```text
10,000 entities
100 dirty transforms
```

Verify that unaffected transforms are not recomputed.

---

## 12. Phase 7 — Render Extraction

Create:

```text
ECS
 ↓
RenderExtractor
 ↓
RenderWorld
```

Example:

```ts
interface RenderObject {
    entityId: number;

    meshId: number;
    materialId: number;

    transformIndex: number;
    boundsIndex: number;

    skinInstanceId: number;
    morphStateId: number;

    flags: number;
}
```

The renderer must operate entirely from `RenderWorld`.

---

## 13. Phase 8 — Materials

Implement shared material storage.

Initial properties:

```text
base color
metallic
roughness
alpha mode
double-sided
```

Later:

```text
base color texture
normal map
metallic-roughness map
occlusion
emissive
```

Use controlled shader flags:

```text
HAS_SKINNING
HAS_MORPH_TARGETS
HAS_NORMAL_MAP
ALPHA_MASK
```

Do not create arbitrary shader permutations.

---

## 14. Phase 9 — Render Queues

Create:

```text
Opaque
Alpha Mask
Transparent
```

Opaque sorting:

```text
pipeline
 ↓
material
 ↓
mesh
 ↓
depth bucket
```

Transparent sorting:

```text
back-to-front
```

Track:

```text
pipeline switches
material switches
mesh switches
```

---

## 15. Phase 10 — Instancing and Batching

Batch by:

```text
pipeline
material
mesh
```

Instance data should eventually contain:

```text
transformIndex
materialIndex

jointOffset
jointCount

morphWeightOffset
morphTargetCount

objectId
```

Use:

```ts
drawIndexed(
    indexCount,
    instanceCount,
    firstIndex,
    baseVertex,
    firstInstance
);
```

### Benchmark

Compare:

```text
10,000 individual cube draws
```

with:

```text
10,000 instanced cubes
```

---

## 16. Phase 11 — Frustum Culling

Implement:

```text
BoundingSphere
AABB
Frustum
FrustumCuller
```

Pipeline:

```text
RenderWorld
   ↓
Frustum Test
   ↓
Visible Renderables
```

Metrics:

```text
total renderables
frustum tested
frustum rejected
visible objects
```

---

## 17. Phase 12 — Spatial Hierarchy / BVH

Implement flat-array BVH.

Use initially for static geometry.

Dynamic objects can remain separate.

Traversal:

```text
test node
 ↓
outside?
 ├─ yes → reject subtree
 └─ no  → traverse children
```

Benchmark against linear frustum culling.

---

## 18. Phase 13 — glTF / GLB Loader

Support:

```text
GLB container
JSON
buffers
bufferViews
accessors
meshes
primitives
nodes
hierarchy
materials
textures
samplers
cameras
animations
skins
morph targets
```

Convert glTF into runtime engine structures.

Never render directly from glTF JSON.

Pipeline:

```text
glTF
 ↓
Parse
 ↓
Decode
 ↓
Engine Assets
 ↓
GPU Upload
 ↓
Resource Managers
```

---

## 19. Phase 14 — PBR Rendering

Support glTF metallic-roughness PBR:

```text
baseColor
metallic
roughness
normal
emissive
occlusion
alpha mode
double sided
```

Avoid one shader per material.

Prefer:

```text
small shader variant set
+
material data
```

---

## 20. Phase 15 — Texture Pipeline

Implement:

```text
sRGB handling
linear data textures
mipmaps
sampler reuse
texture deduplication
anisotropy where supported
```

Later add:

```text
KTX2
Basis Universal
BC
ETC2
ASTC
```

Loading must be asynchronous.

---

## 21. Phase 16 — Animation Runtime

Support:

```text
translation
rotation
scale
morph weights
```

Interpolation:

```text
STEP
LINEAR
CUBICSPLINE
```

Create:

```text
AnimationClip
AnimationChannel
AnimationSampler
Animator
```

Animator supports:

```text
play
pause
stop
loop
speed
current time
```

Animation output updates ECS transform and morph state.

---

## 22. Phase 17 — Skinning Data

Parse glTF:

```text
skin.joints
inverseBindMatrices
skeleton
JOINTS_0
WEIGHTS_0
```

Architect for optional:

```text
JOINTS_1
WEIGHTS_1
```

later.

Separate:

```text
SkeletonAsset
```

from:

```text
SkeletonInstance
```

Static skeleton data:

```text
joint structure
inverse bind matrices
```

Dynamic instance data:

```text
current pose
joint matrices
GPU joint range
```

---

## 23. Phase 18 — Skeleton Updates

Runtime order:

```text
Animation Sampling
      ↓
Local Joint Transforms
      ↓
Transform Hierarchy
      ↓
Joint World Matrices
      ↓
Skinning Matrices
```

Joint matrix convention:

```text
inverse(meshWorld)
× jointWorld
× inverseBind
```

or equivalent according to engine matrix convention.

Document and test the exact convention.

---

## 24. Phase 19 — Shared Joint Matrix Buffer

Do not create one GPU buffer per character.

Use:

```text
JointMatrixBuffer
```

containing many skeleton instances.

Each instance stores:

```text
jointOffset
jointCount
```

Upload only changed skeleton ranges.

Metrics:

```text
active skeletons
joint count
updated joints
joint upload bytes
```

---

## 25. Phase 20 — GPU Skinning

WGSL input:

```wgsl
@location(...) joints0: vec4<u32>,
@location(...) weights0: vec4<f32>,
```

Conceptually:

```wgsl
let skinMatrix =
      joints[jointOffset + input.joints0.x] * input.weights0.x
    + joints[jointOffset + input.joints0.y] * input.weights0.y
    + joints[jointOffset + input.joints0.z] * input.weights0.z
    + joints[jointOffset + input.joints0.w] * input.weights0.w;
```

Apply skinning to:

```text
position
normal
tangent
```

when those attributes exist.

### Critical Rule

Do not CPU-skin meshes during normal frame rendering.

CPU:

```text
update joint matrices
```

GPU:

```text
deform vertices
```

---

## 26. Phase 21 — Morph Target Data

Parse glTF morph targets:

```text
POSITION
NORMAL
TANGENT
```

Read defaults from:

```text
mesh.weights
```

and node overrides:

```text
node.weights
```

Create shared runtime morph state.

```ts
interface MorphState {
    weightOffset: number;
    targetCount: number;
}
```

---

## 27. Phase 22 — Shared Morph Buffers

Create:

```text
MorphWeightBuffer
MorphPositionDeltaBuffer
MorphNormalDeltaBuffer
MorphTangentDeltaBuffer
```

Morph target geometry should contain deltas, not complete duplicate meshes.

Only upload changed morph weights.

---

## 28. Phase 23 — GPU Morphing

Vertex deformation starts with:

```text
base vertex
```

Then:

```text
basePosition
+
Σ(targetPositionDelta × weight)
```

Similarly for:

```text
normal
tangent
```

Normalize normal/tangent as appropriate.

---

## 29. Phase 24 — Combined Morphing + Skinning

Required order:

```text
Base Vertex
    ↓
Morph Targets
    ↓
Skinning
    ↓
Model Transform
    ↓
View
    ↓
Projection
```

This must be consistent across:

```text
main pass
depth pass
shadow pass
```

Shared WGSL helpers should implement the deformation logic.

Suggested files:

```text
morphing.wgsl
skinning.wgsl
common.wgsl
```

Conceptual shader helper:

```wgsl
fn deformVertex(...) -> DeformedVertex {
    var vertex = loadBaseVertex(...);

    if HAS_MORPH_TARGETS {
        vertex = applyMorphTargets(vertex, ...);
    }

    if HAS_SKINNING {
        vertex = applySkinning(vertex, ...);
    }

    return vertex;
}
```

---

## 30. Phase 25 — Animated Bounds

Static bind-pose bounds may become invalid after deformation.

This affects:

```text
frustum culling
occlusion culling
shadow culling
BVH traversal
```

Initial solution:

```text
conservative expanded bounds
```

Possible later improvements:

```text
per-animation bounds
joint bounds
GPU-generated bounds
```

Do not CPU-transform every vertex merely to calculate bounds.

---

## 31. Phase 26 — Animation Blending Preparation

Initial runtime may support one active clip.

Architecture should allow:

```text
crossfade
multiple layers
additive animation
```

Blend:

```text
translation
rotation
scale
morph weights
```

Avoid direct matrix interpolation as the main blending mechanism.

---

## 32. Phase 27 — LOD

Implement screen-space LOD selection.

```text
large on screen → LOD 0
medium          → LOD 1
small           → LOD 2
tiny            → impostor / cull
```

Use hysteresis to avoid flickering.

Track LOD distribution.

---

## 33. Phase 28 — Lighting

Support:

```text
directional
point
spot
```

Store light data in shared GPU buffers.

Do not create one bind group per light.

---

## 34. Phase 29 — Clustered Lighting

Add when many-light benchmarks justify it.

Pipeline:

```text
Lights
  ↓
Compute Shader
  ↓
Clusters
  ↓
Light Lists
  ↓
Fragment Shader
```

Store:

```text
cluster offset
cluster light count
light indices
```

---

## 35. Phase 30 — Shadows

Implement progressively:

```text
directional shadow map
 ↓
shadow frustum culling
 ↓
multiple shadow casters
 ↓
cascaded shadow maps
 ↓
static shadow caching
```

Skinned and morphed geometry must use the same deformation path in the shadow pass.

Never render bind-pose shadows for animated characters.

---

## 36. Phase 31 — Render Graph

Introduce once multiple passes exist.

Represent:

```text
pass
reads
writes
dependencies
```

Example:

```text
Shadow Pass
   ↓
Shadow Texture

Depth Pass
   ↓
Depth Texture

Opaque Pass
   ↓
HDR Texture

Post Process
   ↓
Swap Chain
```

Later support temporary resource reuse.

---

## 37. Phase 32 — Profiling

Track CPU:

```text
simulation
animation
transform update
skeleton update
render extraction
culling
sorting
command encoding
```

Track renderer:

```text
draw calls
triangles
instances
visible objects
culled objects
pipeline switches
material switches
buffer upload bytes
```

Track animation:

```text
active animators
active skeletons
updated joints
joint uploads
active morph states
active morph targets
morph upload bytes
```

Track GPU pass times where supported.

---

## 38. Phase 33 — Depth Prepass

Implement optional depth-only pass.

Benchmark:

```text
high overdraw
expensive fragment shader
simple scenes
```

Do not assume it is always beneficial.

---

## 39. Phase 34 — Hi-Z Depth Pyramid

Choose and document depth convention:

```text
standard Z
or
reversed Z
```

Create hierarchical depth:

```text
Mip 0
 ↓
Mip 1
 ↓
Mip 2
 ↓
Mip 3
 ...
```

Use compute shaders.

Provide debug visualization.

---

## 40. Phase 35 — GPU Frustum Culling

Create GPU object data:

```wgsl
struct GPUObject {
    boundsCenter: vec3<f32>,
    boundsRadius: f32,

    meshId: u32,
    materialId: u32,
    transformId: u32,
    flags: u32,
};
```

Upload object data to storage buffers.

Compute one visibility test per object initially.

Validate against CPU culling.

---

## 41. Phase 36 — GPU Occlusion Culling

For each candidate:

```text
project bounds
 ↓
calculate screen rectangle
 ↓
choose Hi-Z mip
 ↓
compare depth
 ↓
visible / occluded
```

Be conservative.

Accept:

```text
false visible
```

Avoid:

```text
false invisible
```

Treat unreliable near-plane cases as visible.

---

## 42. Phase 37 — GPU Visibility Compaction

Initial implementation:

```text
atomic append
```

Visible object IDs go into:

```text
VisibleInstanceBuffer
```

If profiling shows contention, replace with:

```text
parallel prefix scan
```

Do not prematurely implement the more complex algorithm.

---

## 43. Phase 38 — Indirect Rendering

Generate indirect argument buffers.

Use:

```text
drawIndirect
drawIndexedIndirect
```

Goal:

```text
GPU determines visibility
CPU does not submit every object
```

The CPU should submit batches rather than individual entities.

---

## 44. Phase 39 — GPU-Driven LOD

Move projected-size calculation and LOD choice into compute.

Pipeline:

```text
Frustum
 ↓
Occlusion
 ↓
Screen Size
 ↓
LOD Selection
 ↓
Batch Selection
```

---

## 45. Phase 40 — Temporal Visibility

Store previous-frame visibility.

Use:

```text
previous visibility
previous Hi-Z
```

carefully.

Reset temporal assumptions when:

```text
camera teleports
large camera rotations
projection changes
new objects spawn
large dynamic motion occurs
```

New objects default visible.

---

## 46. Phase 41 — Asynchronous Asset Loading

Asset states:

```text
Unloaded
Loading
Decoded
Uploading
Ready
Failed
```

Pipeline:

```text
Network
 ↓
Parse
 ↓
Decode
 ↓
GPU Upload
 ↓
Asset Ready
```

Do not block rendering while loading.

Use placeholder assets as necessary.

---

## 47. Phase 42 — Streaming

Later add:

```text
LOD streaming
texture streaming
resource eviction
```

Track:

```text
last used frame
reference count
GPU lifetime
```

Do not destroy resources still referenced by submitted GPU work.

---

## 48. Phase 43 — Web Workers

Profile first.

Potential worker candidates:

```text
glTF parsing
BVH construction
asset decompression
mesh preprocessing
animation preprocessing
```

Use transferable buffers where possible.

Avoid copying large typed arrays unnecessarily.

---

## 49. Phase 44 — Advanced Geometry Optimization

Configurable feature, enabled by default on supported adapters under the latest user amendment. Prepare resources during cold renderer initialization. Unsupported adapters and ineligible batches retain the conventional renderer as fallback; callers can explicitly disable the feature. Validate correctness and benchmark enabled/disabled behavior.

Possible features:

```text
mesh clustering
cluster bounds
meshlets
cluster culling
geometry streaming
GPU cluster LOD
```

WebGPU meshlets should be designed around compute + indirect techniques rather than assuming a mesh-shader API.

---

## 50. Mature Frame Pipeline

```text
BEGIN FRAME
    │
    ├── Input
    │
    ├── Simulation
    │
    ├── Animation Sampling
    │     ├── Translation
    │     ├── Rotation
    │     ├── Scale
    │     └── Morph Weights
    │
    ├── Dirty Transform Update
    │
    ├── Skeleton Update
    │
    ├── Joint Matrix Update
    │
    ├── Animated Bounds Update
    │
    ├── Render Extraction
    │
    ├── GPU Uploads
    │     ├── Object Data
    │     ├── Material Data
    │     ├── Joint Matrices
    │     └── Morph Weights
    │
    ├── Hi-Z Preparation
    │
    ├── Compute Visibility
    │     ├── Frustum
    │     ├── Occlusion
    │     └── LOD
    │
    ├── Visibility Compaction
    │
    ├── Indirect Argument Generation
    │
    ├── Shadow Pass
    │
    ├── Depth Pass
    │
    ├── Opaque Pass
    │
    ├── Transparent Pass
    │
    ├── Post Processing
    │
    ├── UI
    │
    └── Submit
END FRAME
```

---

## 51. GPU Buffer Architecture

Target shared buffers:

```text
FrameUniformBuffer

CameraBuffer

TransformBuffer

ObjectBuffer

InstanceBuffer
├── transformIndex
├── materialIndex
├── jointOffset
├── jointCount
├── morphWeightOffset
├── morphTargetCount
└── objectId

MaterialBuffer

LightBuffer

JointMatrixBuffer

MorphWeightBuffer

MorphPositionDeltaBuffer

MorphNormalDeltaBuffer

MorphTangentDeltaBuffer

VisibleInstanceBuffer

IndirectDrawBuffer
```

Avoid thousands of small GPU buffers.

---

## 52. Bind Group Architecture

Recommended starting point:

```text
Group 0 — Frame / Camera

Group 1 — Scene
├── lights
├── shadows
└── environment

Group 2 — Material
├── material data
├── textures
└── samplers

Group 3 — Object / Animation
├── transforms
├── instances
├── joint matrices
├── morph weights
└── morph target data
```

Avoid:

```text
one bind group per bone
one bind group per morph target
one bind group per entity where unnecessary
```

---

## 53. Shader Variant Strategy

Use a compact feature mask.

Examples:

```text
HAS_SKINNING
HAS_MORPH_TARGETS
HAS_NORMALS
HAS_TANGENTS
HAS_NORMAL_MAP
ALPHA_MASK
DOUBLE_SIDED
```

Required logical vertex variants:

```text
static
skinned
morphed
skinned + morphed
```

Avoid generating separate shaders for:

```text
individual skeletons
specific morph target weights
individual material values
```

Those are runtime data.

---

## 54. Testing Strategy

### Unit Tests

Test:

```text
matrix math
quaternion math
transform hierarchy
dirty propagation
frustum extraction
AABB / sphere tests
render sorting
batch building
LOD calculations

animation interpolation
animation channels
morph interpolation

inverse bind matrices
joint hierarchy
joint matrices
weight normalization

morph delta accumulation
skin + morph ordering
```

### Rendering Regression Tests

Maintain:

```text
single cube

1,000 cubes

10,000 instanced cubes

static glTF model

textured PBR model

animated node hierarchy

single-bone character

multi-joint character

morph-only object

facial morph character

skin + morph character

animated crowd

occlusion stress scene

LOD stress scene

many-light scene
```

---

## 55. Animation Regression Scenes

### Scene A — Static Skinned Mesh

Purpose:

```text
bind-pose correctness
```

### Scene B — Single Joint Animation

Purpose:

```text
basic GPU skinning
```

### Scene C — Multi-Joint Skeleton

Purpose:

```text
hierarchy correctness
```

### Scene D — Morph-Only Object

Purpose:

```text
morph delta processing
```

### Scene E — Facial Morph Animation

Animate:

```text
blink
smile
mouth
```

### Scene F — Skinning + Morphing

Purpose:

```text
correct deformation order
```

### Scene G — Animated Crowd

Test:

```text
100
500
1,000 characters
```

---

## 56. Benchmark Suite

### Benchmark A — Draw Calls

```text
10,000 cubes
```

Compare:

```text
individual draws
sorted draws
instancing
```

### Benchmark B — Visibility

```text
100,000 objects
```

Compare:

```text
no culling
CPU frustum
BVH
GPU frustum
GPU frustum + Hi-Z
```

### Benchmark C — Materials

```text
1
100
1,000 materials
```

Measure pipeline and material switching.

### Benchmark D — Animation

Test:

```text
1
100
500
1,000 characters
```

Measure:

```text
animation sampling CPU
transform CPU
skeleton CPU
joint upload bytes
GPU skinning time
draw calls
```

### Benchmark E — Morphing

Test:

```text
0
1
4
8
16 active morph targets
```

Measure:

```text
morph weight uploads
vertex shader cost
GPU frame time
```

### Benchmark F — Combined Skin + Morph

Measure:

```text
CPU animation time
joint uploads
morph uploads
vertex processing time
frame time
```

### Benchmark G — Occlusion

Use dense scenes with significant hidden geometry.

Compare:

```text
frustum only
vs
frustum + Hi-Z
```

---

## 57. Renderer Statistics

Expose:

```text
FPS
frame time

CPU:
simulation
animation
transforms
skeleton
bounds
culling
render extraction
sorting
command encoding

GPU:
shadow
depth
opaque
transparent
post process

Scene:
entities
renderables
visible
frustum culled
occlusion culled

Animation:
active animators
active skeletons
updated joints
joint uploads
active morph states
active morph targets
morph uploads

Rendering:
draw calls
indirect draws
instances
triangles
pipeline switches
material switches

Memory:
buffers
textures
joint data
morph data
```

---

## 58. Performance Rules

The renderer must avoid:

```text
pipeline creation per frame

shader module creation per frame

buffer creation per object

GPU readback in the normal frame path

CPU skinning every frame

CPU morphing every frame

full vertex-buffer reuploads for animation

rendering bind-pose shadows for animated models

culling animated models using invalid static bounds

unbounded shader permutation generation

re-uploading unchanged textures

re-uploading unchanged meshes

render passes querying gameplay ECS directly
```

---

## 59. Milestones

### Milestone 1 — WebGPU Core

Complete:

```text
GPU initialization
canvas
depth
camera
basic mesh
pipeline cache
resource managers
profiling basics
```

Result:

```text
stable basic renderer
```

### Milestone 2 — Scalable CPU Renderer

Complete:

```text
data-oriented ECS
render extraction
render queues
sorting
batching
instancing
frustum culling
BVH
```

Result:

```text
large object counts handled efficiently
```

### Milestone 3 — glTF Renderer

Complete:

```text
glTF / GLB
PBR
textures
materials
node hierarchy
```

Result:

```text
production-style static asset renderer
```

### Milestone 4 — Character Renderer

Complete:

```text
animations
skins
joint matrices
GPU skinning
morph targets
morph animation
combined morph + skin
animated bounds
```

Result:

```text
full animated glTF character support
```

### Milestone 5 — Advanced Renderer

Complete:

```text
LOD
clustered lighting
shadows
render graph
post processing
```

### Milestone 6 — GPU-Driven Renderer

Complete:

```text
Hi-Z
GPU frustum
GPU occlusion
GPU LOD
visibility compaction
indirect rendering
temporal visibility
```

Result:

```text
GPU-driven WebGPU renderer
```

---

## 60. Recommended Implementation Order

Execute in this order:

```text
1. WebGPU bootstrap
2. Basic rendering
3. Math and camera
4. Resource managers
5. Pipeline caching
6. Dynamic buffers
7. Data-oriented ECS
8. Render extraction
9. Materials
10. Render queues
11. Batching
12. Instancing
13. Frustum culling
14. BVH
15. glTF static meshes
16. PBR
17. Textures
18. Animation clips
19. Skeleton parsing
20. Joint hierarchy
21. Shared joint buffer
22. GPU skinning
23. Morph target parsing
24. Shared morph buffers
25. GPU morphing
26. Combined morph + skin
27. Animated bounds
28. LOD
29. Lighting
30. Clustered lighting
31. Shadows
32. Render graph
33. Profiling improvements
34. Depth prepass
35. Hi-Z
36. GPU frustum culling
37. GPU occlusion culling
38. GPU compaction
39. Indirect rendering
40. GPU-driven LOD
41. Temporal visibility
42. Async loading
43. Streaming
44. Web Workers
45. Advanced geometry optimization
```

---

## 61. Definition of Done

The renderer is considered complete when it supports:

```text
WebGPU
TypeScript

Data-oriented ECS
Render extraction

Resource caching
Pipeline caching
Efficient GPU buffers

glTF 2.0 / GLB

Static meshes
Instancing

PBR materials
Textures
Mipmaps
Compressed textures

Node animation

STEP
LINEAR
CUBICSPLINE

Skeletal animation
JOINTS_0
WEIGHTS_0
inverse bind matrices
joint hierarchy

Shared joint buffers
GPU skinning

Morph targets
POSITION morphing
NORMAL morphing
TANGENT morphing

Default morph weights
node morph weights
animated morph weights

Shared morph buffers

Combined:
Morph → Skin

Correct animated:
main pass
depth pass
shadow pass

Animated conservative bounds

Frustum culling
BVH
LOD
Hi-Z occlusion

Directional lights
Point lights
Spot lights
Clustered lighting

Shadows
Render graph

GPU object buffers
GPU visibility
GPU compaction
Indirect drawing
GPU-driven LOD

Async loading
Streaming

Resize handling
Device-loss handling

Profiling
Debug statistics
Regression tests
Benchmark suite
```

---

## 62. Final Target Architecture

```text
                     APPLICATION
                          │
                          ▼
                  DATA-ORIENTED ECS
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
      Simulation      Animation         Morph
                          │               │
                          ▼               │
                     Transforms           │
                          │               │
                          ▼               │
                       Skeleton           │
                          │               │
                          ▼               │
                    Joint Matrices        │
                          │               │
                          └───────┬───────┘
                                  ▼
                         RENDER EXTRACTION
                                  │
                                  ▼
                           RENDER WORLD
                                  │
                                  ▼
                            GPU BUFFERS
            ┌─────────────────────┼─────────────────────┐
            ▼                     ▼                     ▼
        Objects               Joint Data           Morph Data
            │                     │                     │
            └─────────────────────┼─────────────────────┘
                                  ▼
                           COMPUTE VISIBILITY
                       ┌──────────┼──────────┐
                       ▼          ▼          ▼
                    Frustum      LOD      Occlusion
                       └──────────┼──────────┘
                                  ▼
                          VISIBLE INSTANCES
                                  │
                                  ▼
                             COMPACTION
                                  │
                                  ▼
                          INDIRECT COMMANDS
                                  │
                                  ▼
                            RENDER GRAPH
                 ┌────────────────┼────────────────┐
                 ▼                ▼                ▼
              Shadow            Opaque        Transparent
                 │                │                │
                 └────────────────┼────────────────┘
                                  ▼
                           VERTEX DEFORMATION
                                  │
                             Base Vertex
                                  │
                                  ▼
                               Morph
                                  │
                                  ▼
                                Skin
                                  │
                                  ▼
                         Model / View / Projection
                                  │
                                  ▼
                           POST PROCESSING
                                  │
                                  ▼
                               SCREEN
```

The central architectural rule is:

> **ECS organizes simulation data. Render extraction creates renderer-specific data. Shared GPU buffers provide compact runtime state. Morphing happens before skinning. GPU visibility determines what should be rendered. Indirect rendering minimizes CPU submission overhead.**

The renderer should first become a **fast, correct conventional renderer**, then evolve into a **GPU-driven WebGPU renderer** only after profiling shows the simpler architecture is stable and measurable.

## User-requested game-development improvements — 2026-10-04

Implement in the following dependency order, validating and benchmarking each before advancing. Existing architecture and performance rules continue to apply. Phase 44 defaults on where supported under the latest user amendment.

1. Independent asset-instance disposal — implemented and validated.
2. Animation scalability — implemented and validated.
3. Render-resolution controls and anti-aliasing — implemented and validated.
4. Gameplay animation events, root-motion extraction and state machine — implemented and validated.
5. Picking and spatial queries — implemented and validated.
6. Loading responsiveness — implemented and validated.
7. HDR presentation improvements — implemented and validated.
8. Broader input and camera controllers — implemented and validated.

Gameplay subsystems such as general physics, audio, navigation, persistence and networking remain separate game-layer scope.


## User-requested maintenance restructuring — 2026-10-04

Separate cold renderer/post pipeline construction, animation layer bindings, worker protocols, application picking and input listener ownership from frame coordination. Preserve public APIs/import paths, resource identities, deformation order, profiled frame stages, existing feature defaults and Phase 44's optional status. Keep original animation binding construction and tight loops when extracting them adds performance uncertainty. Validate the complete production gate and compare long-animation reference images, work/resource snapshots and timings against the committed game-improvement baseline. Record evidence in `benchmarks/MAINTENANCE_REPORT.md`.


## User-requested particles and visual effects — 2026-10-05

Add optional world-space procedural billboard particles with fixed-capacity typed spawn records, reusable seeded emitters and one-shot sparks/smoke/explosion/confetti/shockwave effects. GPU vertex shading evaluates ballistic/drag motion, size, color, rotation and lifetime fades. CPU work retires lifetimes and orders alpha centers; additive particles require no sorting. No per-particle entities/GPU objects, CPU vertex uploads, normal-frame readback, unbounded variants or steady shader compilation. Feature enablement prepares shared buffers and bounded direct/HDR alpha/additive pipelines; disabled defaults preserve existing mesh behavior and allocate no particle GPU resources.

Compose particles after scene color using read-only scene depth and before HDR/post presentation. Retain CPU provenance on device recovery; let renderer resource ownership destroy GPU objects. Expose enable/pause, emitter settings/rate/position, bursts/presets, fixed capacity, overflow/work counters and cleanup. Procedural particles do not add arbitrary bindings, sprite textures, collision, ribbons/trails, shadow casting or global particle/mesh transparency sorting. Validate lifetime/capacity/determinism, all shapes, blend/depth/reference images, motion/fades, HDR/bloom/FXAA, resize, recovery, resource reuse and teardown; run CPU particle workloads and production browser timing scenarios before the complete validation gate.


## User-requested maintenance restructuring — 2026-10-05

Review the full repository after particle integration. Separate shadow/particle cold GPU construction from frame owners, name the particle spawn/uniform ABI, isolate renderer recovery control replay and separate asset transaction types while preserving existing imports. Keep established focused modules, serialized browser boundaries, resource creation order/identity, seeded emission, dirty ranges, profiled stages, feature defaults and Phase 44 behavior. Validate targeted setup changes before advancing, then run the complete production gate, CPU suite, long-animation GPU matrix and particle reference/timing scenario against a clean committed baseline. Record evidence in `benchmarks/RESTRUCTURE_REPORT.md`.


## User-requested particle effects extension — 2026-10-05

This amendment supersedes the original particle scope exclusions for atlases, soft fades and ribbons/trails. Preserve fixed capacities, typed provenance, cold GPU setup, analytic shading, existing feature defaults and normal-frame no-readback/no-wait rules. Implement and validate/benchmark in dependency order:

1. Shared evenly tiled sprite atlas and lifetime/FPS flipbook playback — implemented; targeted CPU/GPU validation and benchmark passed.
2. Shared bounded lifetime size/color multiplier profiles — implemented; targeted CPU/GPU validation and benchmark passed.
3. Seeded directional cone/sphere emission — implemented; deterministic distribution/limits tests and birth benchmarks passed.
4. Soft depth-intersection fades using existing scene depth — implemented; perspective/orthographic linear-reference tests passed.
5. Fixed-capacity connected ribbons/trails, GPU strip expansion and endpoint aging — implemented; bounded-history, join, blend, soft-depth, recovery and warm-resource checks plus CPU/GPU benchmarks passed.

Combined demonstration and documentation are complete. Production validation passes 256 tests across 66 files and all GPU gates; extended effect benchmarks and the long-animation regression matrix pass. Evidence is recorded in `benchmarks/PARTICLE_VFX_REPORT.md`. Keep collisions, mesh particles, arbitrary particle shaders, global transparency sorting and general gameplay physics outside this extension.


## User-requested memory accounting and budget-aware streaming — 2026-10-05

Track owned GPU texture storage including all mip chains, compressed blocks, array/volume layers, samples and render targets. Report unique retained recovery backing stores alongside decoded caches. Preserve shared-resource ownership, cold GPU setup, existing defaults and normal-frame no-wait/no-readback constraints.

Implement in dependency order: descriptor accounting and lifecycle subtraction; retained provenance snapshots; opt-in priority/concurrency/reservation streaming admission and safe pressure eviction; real-GPU fallback/recovery/rollback checks; documentation and complete regression validation. Targeted unit tests, production GPU validation and cold CPU benchmarks pass. The final full gate passes 262 tests across 67 files and every GPU scenario. The long-animation regression matches 2,815 existing non-timing values; evidence is recorded in `benchmarks/MEMORY_STREAMING_REPORT.md`. Limits govern tracked streamed residency/publication, with explicit authored estimates; driver overhead and transient unknown-size uploads are not claimed as a hard physical memory ceiling.


## User-requested local shadows and authored PBR — 2026-10-05

Extend the existing shared shadow array to point and spot lights without new per-frame GPU objects or separate deformation paths. Preflight mixed light capacity transactionally; spots reserve one layer, points six, directional lights their existing cascades, within sixteen layers. Expose validated near/depth/normal bias settings, per-face culling and cache reuse. Validate local projection conventions, invalid inputs/capacity, production images and warm resources; benchmark before advancing to authored PBR.

Add glTF clearcoat (all three maps), IOR/specular (both maps), emissive strength, unlit and per-role texture transforms using fixed shared material storage and bounded texture bindings. Preserve custom shader family/helper contracts, core factor offsets, alpha/deformation consistency, compression/mip ownership and recovery. Complete streamed layouts retain affine transforms/map flags. Targeted unit/GPU checks, cold CPU benchmarks and the complete validation gate pass; long-animation production benchmarking is recorded in `benchmarks/AUTHORED_RENDERING_REPORT.md`. Transmission/refraction, sheen, anisotropy and cross-face point PCF remain outside this extension. Existing user amendments and Phase 44 defaults remain in force.


## User-requested render-graph lifetimes and transient target reuse — 2026-10-06

Compile first/last-use intervals for explicit graph versions. Add exact-compatible transient texture interval coloring with strict nonoverlap, imported/persistent exclusions, exported end-of-graph retention and an explicit first-writer clear/full-write contract. Acquire physical leases and views once during cold graph preparation, rolling back partial failure. Preserve stable hot dispatch and established feature defaults.

Add a device-local idle byte/count-bounded target pool with submitted-work completion quarantine, failed-fence cleanup and teardown protection. Use leases for HDR scene/bloom/luminance resize targets; retain persistent depth, Hi-Z, cached shadows and exposure state ownership. Never acquire, wait, create groups/targets or analyze lifetimes on a steady frame. Configuration/release happens between submissions; unsubmitted command buffers referencing released targets are prohibited by the ownership contract. Validate CPU intervals/compatibility/rollback/fences, real GPU alias results/resize reuse/disposal, cold compilation and hot dispatch benchmarks, and the full production regression matrix. Record evidence in `benchmarks/RENDER_GRAPH_REPORT.md`.


## User-requested unified transparency — 2026-10-06

Supersede the earlier VFX exclusion for global transparency sorting. Merge transparent mesh sphere-center depths, analytic billboard centers and ribbon midpoints into one stable back-to-front schedule. Keep opaque/masked depth finalization first, read-only depth testing/sampling during alpha composition, and additive billboards/ribbons after all alpha layers. Preserve authored coverage, shared deformation/material shader paths, CPU instancing and GPU-selected visibility/LOD.

Reserve fixed typed schedule capacity at setup, preserve source queue ranks separately from GPU visible-record offsets, coalesce compatible consecutive ranges and split only at cross-stream boundaries. Retain no-effects behavior and public standalone particle encoding; never construct GPU resources, wait or read visibility in steady frames. Expose accurate draw counters and a separate opt-in transparency timestamp. Validate stable ties, batching/splitting/capacity/LOD ranks, independent reference ordering, mixed analytic GPU pixels, camera reversal, custom families, HDR, prepass, disabled effects, opaque occlusion, recovery and alternating stress. Benchmark coalesced and alternating workloads before completion; record full validation/regression evidence in `benchmarks/TRANSPARENCY_REPORT.md`. Center/midpoint ordering does not promise per-pixel correctness for intersecting geometry; order-independent transparency remains outside this extension.
