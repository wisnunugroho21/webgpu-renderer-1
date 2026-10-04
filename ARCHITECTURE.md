# Codebase guide

`IMPLEMENTATION_PLAN.md` defines feature scope, architecture, and performance rules. `PROGRESS.md` records implementation evidence and the user's amendment making Phase 44 optional. This guide describes the code organization and where to make changes.

## Start reading here

1. `src/main.ts` creates the browser application.
2. `src/app/Application.ts` owns browser lifecycle, frame order, and recovery publication; `ApplicationAssets.ts` owns scene/asset transactions.
3. `src/rendering/RenderExtractor.ts` copies ECS state into the persistent `RenderWorld` snapshot.
4. `src/rendering/Renderer.ts` prepares visibility, sorts batches, uploads shared frame state, and executes the render graph. `passes/ColorPass.ts` owns color variants, HDR/IBL inputs, and batch drawing.
5. `src/rendering/graph/configureRenderGraph.ts` declares pass dependencies. Individual pass classes encode the GPU work.

## Module ownership

| Directory                                  | Responsibility                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `src/app`                                  | Browser lifecycle and frame orchestration                                                                      |
| `src/ecs`                                  | Gameplay entities, component arrays, transform/animation/skeleton/bounds systems                               |
| `src/input`                                | Focus-scoped keyboard state and input listener lifecycle                                                       |
| `src/examples`                             | Collection game model and application hooks demonstrating renderer use                                         |
| `src/animation`                            | Clip sampling, poses, morph pools, skeleton assets and per-character palettes                                  |
| `src/assets`                               | Fetch/decode/cache states, worker transfers, GPU upload preparation, scene instantiation and streaming records |
| `src/math`                                 | Allocation-conscious vector, quaternion and column-major matrix operations                                     |
| `src/visibility`                           | CPU frustum and static BVH queries                                                                             |
| `src/rendering`                            | Renderer-owned snapshots, queues, sorting, batches, shared instance/material/light/deformation storage         |
| `src/rendering/pipelines`                  | Cold color shader assembly, binding layouts and bounded pipeline variants                                      |
| `src/rendering/geometry`                   | Vertex layout, cold primitive preparation, mesh clusters and optional cluster culling                          |
| `src/rendering/graph`                      | Cold dependency validation and persistent pass schedule                                                        |
| `src/rendering/visibility`                 | GPU frustum, Hi-Z, occlusion, compaction, temporal reuse and indirect draws                                    |
| `src/rendering/lod`, `lighting`, `shadows` | Authored mesh selection, clustered lights and directional shadow management                                    |
| `src/gpu`                                  | Device/context, resource ownership and caches, shared dynamic arena                                            |
| `src/shaders`                              | Shared WGSL declarations/helpers and pass entry points                                                         |
| `src/profiling`                            | Fixed CPU history, rendering counters and explicitly requested GPU timestamp capture                           |
| `tests`                                    | Unit correctness and CPU workload benchmarks                                                                   |
| `scripts/gpu`                              | Browser GPU scenarios, Node report assertions and isolated server lifecycle                                    |

Existing import paths and public APIs remain stable. Small focused modules stay in place; modules are separated where they have distinct ownership or lifetimes.

## Frame flow

The application dispatches bounded fixed-step gameplay and variable update hooks, then updates animation, world transforms, the selected ECS camera, joint palettes and conservative animated bounds before extracting render state. Renderer passes consume `RenderWorld`; they do not query ECS stores.

Animation samplers contain shared immutable keys. Each Animator clip/channel binding owns its lower-key hint; steady playback checks the same or adjacent interval, while arbitrary seeks and wraps use binary search. Short clips bypass hint bookkeeping. Hint state never lives on the shared clip, so character phases and crossfade source/destination timelines remain independent. Sampling and pose preparation allocate only during setup; long-clip benchmark reference sampling/readbacks are diagnostic operations outside the ordinary frame path.

Optional animation layers own playback clocks and persistent binding/reference poses per controller. Base and layered pose storage are separate: frame composition cannot accumulate additive deltas or feed a layered pose back into an interrupted base crossfade. Node masks resolve on installation. GPU deformation still consumes the final ECS snapshot, so color/depth/shadow/bounds follow the same composite pose.

`src/rendering/environment` separates pure HDR data validation/half packing and cold convolution/BRDF baking from GPU ownership. Renderer-wide EnvironmentLighting serializes transactional replacement and fences retirement. No environment textures/pipelines exist before installation. The existing color pipeline table stays unchanged; a bounded optional table adds group 2 for one shared diffuse cube, prefiltered GGX cube, split-sum LUT, filtering sampler and 16-byte uniform. Default ambient shading remains available when the environment is absent/disabled. No per-material environment groups, normal-frame preprocessing, waits or resource creation. Environment controls flush only changed uniforms. Clear retires textures/buffer; renderer disposal also releases cached pipelines/samplers. `/?example=lighting` demonstrates the API with a shared sphere mesh.

`Renderer.encode()` makes the preparation order explicit:

1. Resize-dependent resources update when dimensions change.
2. `configureFeatureDependencies()` enables prerequisites for requested optional paths.
3. `prepareVisibility()` updates the camera, selects CPU visibility/LOD, and records statistics. GPU indirect submission defers object selection to compute passes.
4. `prepareBatches()` builds the queue, sorts pipeline/material/mesh runs, and groups instances.
5. `uploadFrameState()` fills persistent staging arrays, advances the arena slot, uploads dirty shared records, and prepares optional GPU paths.
6. The compiled graph encodes all enabled work; the application submits one command buffer.

The compiled graph order is GPU frustum → shadows → light clusters → depth → geometry clusters → Hi-Z → GPU occlusion → GPU LOD → compaction → indirect arguments → color → tone mapping → Hi-Z debug. Optional pass callbacks may do no work. Resource names describe explicit versions/dependencies, not a transient resource allocator.

Color, camera depth and shadow shaders share `deformVertex`: base attributes → additive morph deltas → joint blending → model transform. Normal cofactors and determinant signs preserve nonuniform scale, shear and reflection. CPU bounds must conservatively cover the same deformation before visibility tests.

## GPU layouts and resource lifetime

`src/rendering/layouts.ts` names record strides; `geometry/VertexLayout.ts` defines the interleaved vertex attributes; `FrameUniforms.ts` packs the frame uniform. Match these with `frame.wgsl`, `geometry.wgsl`, and `shadows.wgsl` when editing an ABI.

| Record                 | Bytes | Notes                                                                                |
| ---------------------- | ----: | ------------------------------------------------------------------------------------ |
| Vertex                 |   104 | 26 words; joint indices are integer bits within interleaved storage                  |
| Frame                  |   192 | 48 floats; two matrices plus eye/light count, cluster, lighting and viewport vectors |
| Transform/joint matrix |    64 | Column-major `mat4x4<f32>`                                                           |
| Instance               |    48 | 12 unsigned words, including reserved padding                                        |
| Material               |    80 | Five `vec4<f32>` records                                                             |
| Light                  |    64 | Four `vec4<f32>` records                                                             |
| Shadow                 |    80 | View-projection matrix and cascade settings                                          |

Initialization prepares caches, shared buffers, binding groups and bounded color variants. Asset upload prepares textures, list topology, missing flat normals, vertex packing, morph deltas and eligible static mesh clusters. `assets/uploadAsset.ts` yields between primitive uploads and rechecks the device after asynchronous boundaries; individual primitive packing remains synchronous. Upload ownership stays local until all primitives succeed; failures release buffers, material slots, texture leases and shared delta ranges.

Ordinary frames reuse GPU resources and persistent typed arrays. The dynamic arena rotates three preallocated slots, with aligned offsets and one flush. Queue ordering protects writes/submissions; ordinary frames do not map buffers or wait for completion. Dirty joint, morph, material and light ranges avoid unchanged uploads. Resolve named ABI offsets outside tight vertex/instance loops; repeated module/property lookups can undermine otherwise equivalent refactors. Mesh/material IDs identify shared assets; entities never own separate mesh buffers.

Resize allocation, asset loading and first supported enable of optional geometry optimization are cold paths. Streaming eviction and whole-asset unloading wait for submitted work asynchronously outside the frame loop. `AssetInstances` tracks application-created nodes/primitives and retained cache leases. Unloading vetoes external consumers before removal, retires controllers/skins/morph states, refreshes extraction synchronously, then fences GPU resources. Shared texture reference counts preserve other assets. Cold registry compaction remaps ECS IDs; arena offsets and live views remain stable. Legacy world entity IDs stay monotonic; opt-in handles reuse retired slots.

`AssetLoader` passes abort signals through fetch, decode and upload. Worker jobs remove cancelled callbacks without terminating other jobs. Uploads recheck signals at yield boundaries. LRU cache budgets protect retained/pending/latest loads; application byte accounting deduplicates decoded backing buffers. Failure metadata/history are bounded and failed cleanup retains ownership for retry. `Application.dispose()` is asynchronous and cancels/cleans assets before destroying the device.

`SimulationLoop` keeps callback arrays stable during dispatch and allocates new arrays only on subscription changes. Fixed simulation/collision and interpolated visual poses are separate in the collection example. Keyboard state clears on canvas/window focus loss and hidden documents. Pause/resume resets timing debt; ordinary frames keep one RAF loop and one command-buffer submission.

`CameraSystem` is application/ECS-side and reads camera components after world transforms update. It follows glTF local -Z/+Y and changes renderer projection only when settings change. Direct camera use is selected with `setActiveCamera(null)`. FrameUniforms retains the 192-byte ABI: lighting.z bit 0 enables clustering, bit 1 selects orthographic math. Camera near/far drive cluster slicing and cascade bounds. Both CPU/GPU LOD use constant projected size for orthographic cameras; shadow receiver corners and PBR view direction also use projection-appropriate math.

## Optional features and correctness constraints

CPU instancing is the default. BVH, depth prepass, GPU visibility/occlusion/indirect submission, temporal reuse, and Phase 44 geometry optimization remain measured optional choices. Phase 44 remains disabled by default, with static multi-cluster triangle eligibility and conservative fallbacks for unsupported/deforming/transparent/overflowing batches.

Hi-Z reduces maximum standard-Z depth over complete footprints, including odd dimensions. Occlusion keeps near-plane intersections visible and tests every touched cell. Temporal visibility reuse requires an exact stable snapshot. GPU-generated counts are reported as unknown (`-1`) in CPU frame statistics where observing them would require readback. Diagnostic APIs can return the actual counts explicitly.

Changing a shader layout, culling rule, deformation helper or pass dependency requires real GPU validation; compilation alone cannot establish image equivalence or conservative visibility.

## Validation and maintenance

```sh
npm run format
npm run format:check
npm test
npm run build
RENDERER_PREVIEW=1 npm run validate:gpu
npm run validate:assets
npm run validate:game
npm run benchmark -- --outputJson artifacts/benchmarks.json
npm run benchmark:gpu
```

Prettier formats supported source/configuration/docs. `scripts/format-shaders.mjs` formats WGSL whitespace and verifies token preservation before writing. Generated assets, benchmark evidence, the source plan and historical progress log are excluded from automatic formatting.

`validate-gpu.mjs` owns browser lifecycle and smoke orchestration. `gpu/smoke-checks.mjs` contains camera/resource/loading/worker/draw diagnostics. `gpu/regression-scene.mjs` retains one integrated scene because the checks deliberately exercise state changes and shared asset lifetimes; its helpers must stay inside the serialized browser callback. `gpu/regression-assertions.mjs` validates the report in Node. The matrix uses the corresponding benchmark scenario and assertions modules. Browser callbacks cannot close over Node imports: Playwright serializes their function source.

GPU harnesses require installed Chrome and a WebGPU adapter. Readbacks and completion waits are intentional diagnostic operations. Benchmark timings depend on the machine, scheduling and warmup; compare resource counts, work performed and image/reference correctness alongside timing. A refactor does not establish a universal speedup.

`src/rendering/post/HDRRendering.ts` owns optional scene-color and presentation state through Resources. Enabling it cold creates format-specific PBR variants and a fullscreen pipeline; environment installation prepares the corresponding HDR/IBL variants regardless of activation order. The same geometry, deformation, material blend and depth rules render into rgba16float. Graph order is color → tone-mapping → Hi-Z debug; the disabled presentation callback is a no-op. Pixel loads avoid samplers and resampling; exposure/curve update one dirty 16-byte uniform. The sRGB presentation attachment alone performs display encoding. Toggles retain bounded resources; resize replaces the scene target; renderer-wide disposal releases ownership. GPU timestamp label 11 identifies tone mapping.

Entity storage now offers two allocation paths: legacy monotonic numeric IDs and opt-in recyclable handles. World owns a fixed free-index stack, Float64 safe-integer generations and a WeakSet of authentic world-scoped handles. Handle-created slots alone return to the free stack. Generation exhaustion retires a slot. SoA stores continue using dense numeric indices; handle resolution is an application boundary operation. Application handle-based loading collects exact allocated identities for transactional rollback and unload, avoiding contiguous-range assumptions. Retained animator/skeleton/camera references capture generations; RenderWorld carries CPU-only entity generations so BVH membership and temporal visibility recognize replacement identities. GPU layouts remain unchanged.

Device-loss recovery is a cold Application transaction. MeshManager retains packed CPU recovery arrays; MaterialTextures retains live preparation definitions; environment installation retains linear CPU data. Application quiesces asset/stream work before changing managers, requests a new adapter/device, restores renderer controls and shared assets with stable IDs, replaces texture lease references, rebinds streaming and forces dynamic uploads. Commit follows GPU validation; failures retain CPU definitions for retry. Camera identity remains stable; GPU renderer objects change. Disposal prevents publication of a replacement. Explicit unprovenanced custom GPU resources reject recovery. No recovery allocation, waiting or readback occurs in the steady frame path.

Environment file decoding dynamically loads HDR/EXR parsers into the cold asset path. EnvironmentLoader canonicalizes row orientation/radiance, keys bounded CPU bake ownership by source content and options, and deduplicates pending work. EnvironmentSkybox lazily prepares one inverse-view-projection uniform and bounded LDR/HDR pipelines; it samples existing environment radiance, depth-tests at the far plane, and draws within the scene color pass before geometry. Its background remains off by default. Recovery restores the environment definition and skybox controls.

Eight-weight meshes preserve the 104-byte vertex and 48-byte instance layouts and existing vertex storage-binding count. Secondary joint IDs/weights occupy two vec4 records per vertex after target-major morph records in the shared tangent arena; IDs are stored as exact numeric floats rather than denormal bit patterns. SKIN_EIGHT selects additional palette contributions in the common deformation helper. All passes apply morph → joint blend → model; LOD records carry the selected mesh's arena base and vertex count. LOD compatibility rejects different influence layouts. Cold mesh upload, rollback, unload and recovery own the combined arena allocation.

GLTFLoader lazily registers Draco/Meshopt/quantization/Basis extension decoding and retains engine-owned accessor arrays. AssetDecoder uses the same loader in its persistent transferable worker. MaterialTextures owns lazy Basis workers, format negotiation, authored mip upload and RGBA fallback; compressed and uncompressed outputs enter the same role-specific content cache and lease lifecycle. Three.js contributes cold file/transcoder helpers only; it never owns engine scenes or GPU rendering. No decoder work occurs in rendering frames.

## Focused ownership boundaries

The application facade preserves existing public properties and loading methods. `ApplicationAssets` owns fetch/decode/upload records, controller/entity rollback, exact entity allocation and unload vetoes. Its context resolves the current GPU/renderer at operation time, so recovery cannot leave a service pointing at retired resources. Unload detaches consumers synchronously before its asynchronous GPU fence. `rebuildDeviceResources` prepares and validates a replacement; Application publishes leases, streaming, device and renderer together, then resumes the prior loop state. Both preparation and publication retain failure cleanup.

`GLTFLoader` remains the public main/worker facade. `GLTFCodecs` owns optional dependency registration and retryable decoder startup. `convertRuntimeAsset` copies normalized document/accessor data into engine-owned arrays without fetching or uploading. Codec state cannot leak into ECS or rendering frames.

`MaterialTextures` owns role-specific cache references, preparation transactions, bind groups and recovery definitions. `TextureUploader` handles image/Basis/native decoding, GPU texture upload and partial-upload destruction. The manager closes shared bitmaps after all pending work settles. `TextureSampler` isolates glTF sampler policy while preserving the original exported helper. Environment decoding is similarly separate from bounded bake caching. Both cache owners use `assets/contentHash.ts` after snapshotting mutable source bytes.

`ColorPass` owns bounded default/HDR/environment pipeline sets and reuses existing buffers/material/mesh/pass owners. Render graph callbacks stay persistent and compile in `Renderer.configurePasses`; frame order and GPU layouts remain unchanged. Current clear color, depth view and dynamic instance offset are passed into encoding rather than captured at setup. `ColorPipelineLayout` names queue-ID groups and variant offsets shared by table creation and selection. Ordinary frames add no resource creation, cache work, decoder work, completion waits or readbacks.

For a complete integration gate, run `npm run validate`. It runs formatting, unit tests, production build and every GPU validation in order, stopping at the first failure. Benchmark timing remains separate: `npm run benchmark`, `npm run benchmark:gpu`, and `npm run benchmark:gpu -- --long-animation`. This avoids overlapping validation jobs with timed workloads. See `benchmarks/STRUCTURE_REPORT.md` for equivalence and performance evidence from this restructuring.
