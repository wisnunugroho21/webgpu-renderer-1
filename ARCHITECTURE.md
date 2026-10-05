# Codebase guide

`IMPLEMENTATION_PLAN.md` defines feature scope, architecture, and performance rules. `PROGRESS.md` records implementation evidence and the user's amendments making Phase 44 configurable and default-on where supported. This guide describes the code organization and where to make changes.

## Start reading here

1. `src/main.ts` creates the browser application; `examples/installExample.ts` selects the demonstration after startup.
2. `src/app/Application.ts` owns browser lifecycle, frame order, and recovery publication; `ApplicationAssets.ts` owns scene/asset transactions; `ApplicationPicking.ts` owns CSS picking and live identity checks. `createDefaultScene.ts` owns the initial cube/sun fixture.
3. `src/rendering/RenderExtractor.ts` copies ECS state into the persistent `RenderWorld` snapshot.
4. `src/rendering/Renderer.ts` prepares visibility, sorts batches, uploads shared frame state, and executes the render graph. `createRendererResources.ts` builds shared GPU owners in dependency order; `passes/ColorPass.ts` selects prepared color variants, owns HDR/IBL presentation inputs, and draws batches; `materials/CustomMaterialShaders.ts` owns custom-family registration and preparation.
5. `src/rendering/graph/configureRenderGraph.ts` declares pass dependencies. Individual pass classes encode the GPU work.

## Module ownership

| Directory                                  | Responsibility                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `src/app`                                  | Browser lifecycle and frame orchestration                                                                      |
| `src/ecs`                                  | Gameplay entities, component arrays, transform/animation/skeleton/bounds systems                               |
| `src/input`                                | Keyboard/pointer/touch/gamepad state; InputScope owns DOM listener cleanup                                     |
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

## Cold setup and data boundaries

The color pipeline entry point remains `pipelines/createColorResources.ts`. It coordinates four focused concerns in the original native construction order: WGSL assembly (`colorShaderSource.ts`), binding layout (`createColorBindings.ts`), pipeline variants (`createColorPipelines.ts`), then shared frame groups (`createColorBindings.ts`). `ColorResources.ts` names their input/output contracts. Existing imports of `colorShaderSource` and `ColorResourcesInput` through the entry point remain supported. Binding/pipeline objects are reused, never reconstructed by the draw loop.

`materials/CustomMaterialShaders.ts` serializes registration, validates WGSL before committing CPU provenance, replays definitions on device recovery, and prepares direct/HDR/environment tables. Those arrays are retained and read directly by `ColorPass.encode()`. The `Resources` owner still owns GPU destruction; the custom-family coordinator does not independently destroy cached objects. `MaterialManager` retains slot allocation, PBR packing, shader selection and the public diagnostics. `MaterialShaderParameters` owns only the shared custom parameter rows, validation and dirty upload range. `MaterialManager.shaderParameters` aliases that same CPU table; no extra copy or GPU table is introduced.

`assets/gltf/convertRuntimeAsset.ts` is the pure conversion coordinator. `convertGeometry.ts` validates primitives/skins; `convertMaterials.ts` copies PBR/texture metadata; `convertScene.ts` resolves nodes, clips, cameras and scene roots. `readAccessor.ts` copies normalized values into independent typed arrays. Named `RuntimeMesh`, `RuntimeNode`, `RuntimeTexture`, `RuntimeSkin`, `RuntimeAnimationChannel`, `RuntimeAnimation` and `RuntimeCamera` records document the worker-transfer boundary in `RuntimeAsset.ts`. These converters never fetch, publish ECS entities or allocate GPU resources. Keep list order, reference indices, missing-value sentinels, validation order and array ownership stable when changing them.

`app/createDefaultScene.ts` constructs the default fixture before GPU startup. It preserves cube entity, material-zero and directional-light allocation order. `examples/installExample.ts` owns URL example selection, lazy lighting/shader imports and diagnostic readiness flags. Browser status, startup errors, pagehide and HMR cleanup stay in `main.ts`.

## Where to make a change

| Change                               | First module to inspect                                       | Contract to preserve                                |
| ------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------- |
| Game update order or device recovery | `app/Application.ts`, `app/rebuildDeviceResources.ts`         | Update/extraction order and atomic replacement      |
| Demo startup or a new example        | `app/createDefaultScene.ts`, `examples/installExample.ts`     | Default slot IDs and example cleanup                |
| Imported geometry/material metadata  | `assets/gltf/convertGeometry.ts`, `convertMaterials.ts`       | Independent arrays, indices and validation          |
| Worker transfer payload              | `assets/gltf/RuntimeAsset.ts`, worker protocol                | Serializable metadata and buffer ownership          |
| Custom shader registration           | `rendering/materials/CustomMaterialShaders.ts`                | Validation before commit; recovery replay           |
| Custom material parameters           | `rendering/materials/MaterialShaderParameters.ts`             | 16 f32 values per row; dirty uploads only           |
| Color bindings, WGSL or variants     | `rendering/pipelines/createColorResources.ts` and its helpers | Shared ABI, bounded variants and setup order        |
| Draw submission                      | `rendering/passes/ColorPass.ts`, `Renderer.ts`                | Prepared resources only; snapshot input             |
| Animation throughput                 | `animation/Animator.ts`, sampling and ECS systems             | Persistent binding state and allocation-free loops  |
| Browser regression or benchmark      | `scripts/gpu` and validation entry points                     | Serialized browser callbacks must be self-contained |

Focused math, sampling, bounds, visibility and queue kernels remain separate from setup helpers. Avoid adding generic per-frame context objects, closures or directory-wide barrels merely to shorten files. Browser benchmark callbacks passed to `page.evaluate()` deliberately keep browser-local dependencies inside the serialized callback; importing Node helpers into that callback would break the harness.

## Particle snapshot and composition

`src/particles/ParticleSystem.ts` owns fixed-capacity packed spawn provenance, clock, dense retirement and emitter slots. `ParticleEmitter.ts` owns seeded/rate controls; `ParticleEffects.ts` supplies one-shot presets. These owners contain no GPU objects or ECS traversal. `Application` advances this system after gameplay hooks and retains it across recovery; an optional system can be supplied as its fifth constructor argument.

`rendering/particles/ParticleRenderer.ts` attaches an explicit enable-time setup callback, prepares three shared buffers and four bounded pipelines, and consumes numeric spawn records. `ParticleDepthSorter.ts` reuses radix scratch to sort alpha centers without per-frame array views. `shaders/particles.wgsl` evaluates motion, color, size, fade and rotation while generating six billboard vertices per instance. Steady motion uploads only camera/time unless order changes; birth/dense retirement writes dirty rows. Default disabled scenes create no particle GPU objects. Resources owns destruction; GPU-owner disposal detaches setup notifications while application provenance survives recovery.

The graph versions scene color through `color → particles → post-processing → tone-mapping`. Particle composition loads scene color, reads main depth without writing it, and outputs `particleSceneColor`; post-processing depends on that version. Direct and FXAA/HDR targets share the same particle geometry/coverage. Alpha particles sort by center, followed by additive particles; they do not participate in scene-mesh transparency sorting, shadow passes or geometry clusters. CPU particle lifetime work is included in the existing animation preparation stage; renderer particle counters report draw/upload work separately. See [PARTICLES.md](PARTICLES.md).

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

The compiled graph order is GPU frustum → shadows → light clusters → depth → geometry clusters → Hi-Z → GPU occlusion → GPU LOD → compaction → indirect arguments → color → post-processing → tone mapping → Hi-Z debug. Optional pass callbacks may do no work. Resource names describe explicit versions/dependencies, not a transient resource allocator.

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

Initialization prepares caches, shared buffers, binding groups and bounded color variants. Asset upload prepares textures, list topology, missing flat normals, vertex packing, morph deltas and eligible static mesh clusters. `assets/uploadAsset.ts` yields between primitive uploads and rechecks the device after asynchronous boundaries; large worker jobs transfer prepacked meshes and large vertex/index uploads yield in bounded chunks; small/main-path packing and deformation-arena append remain synchronous. Upload ownership stays local until all primitives succeed; failures release buffers, material slots, texture leases and shared delta ranges.

Ordinary frames reuse GPU resources and persistent typed arrays. The dynamic arena rotates three preallocated slots, with aligned offsets and one flush. Queue ordering protects writes/submissions; ordinary frames do not map buffers or wait for completion. Dirty joint, morph, material and light ranges avoid unchanged uploads. Resolve named ABI offsets outside tight vertex/instance loops; repeated module/property lookups can undermine otherwise equivalent refactors. Mesh/material IDs identify shared assets; entities never own separate mesh buffers.

Resize allocation, asset loading and first supported enable of optional geometry optimization are cold paths. Streaming eviction and whole-asset unloading wait for submitted work asynchronously outside the frame loop. `AssetInstances` tracks application-created nodes/primitives and retained cache leases. Unloading vetoes external consumers before removal, retires controllers/skins/morph states, refreshes extraction synchronously, then fences GPU resources. Shared texture reference counts preserve other assets. Cold registry compaction remaps ECS IDs; arena offsets and live views remain stable. Legacy world entity IDs stay monotonic; opt-in handles reuse retired slots.

`AssetLoader` passes abort signals through fetch, decode and upload. Worker jobs remove cancelled callbacks without terminating other jobs. Uploads recheck signals at yield boundaries. LRU cache budgets protect retained/pending/latest loads; application byte accounting deduplicates decoded backing buffers. Failure metadata/history are bounded and failed cleanup retains ownership for retry. `Application.dispose()` is asynchronous and cancels/cleans assets before destroying the device.

`SimulationLoop` keeps callback arrays stable during dispatch and allocates new arrays only on subscription changes. Fixed simulation/collision and interpolated visual poses are separate in the collection example. Keyboard state clears on canvas/window focus loss and hidden documents. Pause/resume resets timing debt; ordinary frames keep one RAF loop and one command-buffer submission.

`CameraSystem` is application/ECS-side and reads camera components after world transforms update. It follows glTF local -Z/+Y and changes renderer projection only when settings change. Direct camera use is selected with `setActiveCamera(null)`. FrameUniforms retains the 192-byte ABI: lighting.z bit 0 enables clustering, bit 1 selects orthographic math. Camera near/far drive cluster slicing and cascade bounds. Both CPU/GPU LOD use constant projected size for orthographic cameras; shadow receiver corners and PBR view direction also use projection-appropriate math.

## Optional features and correctness constraints

CPU instancing is the default. BVH, depth prepass, GPU visibility/occlusion/indirect submission and temporal reuse remain measured optional choices. Phase 44 geometry optimization defaults on for supported adapters, remains explicitly disableable, and retains static multi-cluster triangle eligibility and conservative fallbacks for unsupported/deforming/transparent/overflowing batches. Its supported resources are prepared during cold renderer construction.

Hi-Z reduces maximum standard-Z depth over complete footprints, including odd dimensions. Occlusion keeps near-plane intersections visible and tests every touched cell. Temporal visibility reuse requires an exact stable snapshot. GPU-generated counts are reported as unknown (`-1`) in CPU frame statistics where observing them would require readback. Diagnostic APIs can return the actual counts explicitly.

Changing a shader layout, culling rule, deformation helper or pass dependency requires real GPU validation; compilation alone cannot establish image equivalence or conservative visibility.

## Validation and maintenance

```sh
pnpm run format
pnpm run format:check
pnpm test
pnpm run build
RENDERER_PREVIEW=1 pnpm run validate:gpu
pnpm run validate:assets
pnpm run validate:game
pnpm run benchmark --outputJson artifacts/benchmarks.json
pnpm run benchmark:gpu
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

For a complete integration gate, run `pnpm run validate`. It runs lint, formatting, unit tests, production build and every GPU validation in order, stopping at the first failure. Benchmark timing remains separate: `pnpm run benchmark`, `pnpm run benchmark:gpu`, and `pnpm run benchmark:gpu --long-animation`. This avoids overlapping validation jobs with timed workloads. See `benchmarks/STRUCTURE_REPORT.md` for equivalence and performance evidence from this restructuring.

## Game integration owners

`AssetInstances` owns one record and lease per independent spawned asset. `ApplicationAssets.instantiateAsset` exposes an immutable lifetime facade; asynchronous instance disposal performs CPU detachment without destroying shared cached GPU data. URL unload and recovery remain manager-level operations.

Animation marker crossing and named state transitions belong to controllers. `RootMotionSampler` returns rigid local-space deltas into caller storage; gameplay applies those to an actor. Explicit manual update mode separates fixed simulation clocks from pose preparation. Optional reduced-rate evaluation advances clocks every tick while all render passes use the same held deformation pose.

`SpatialQueries` reads extracted conservative bounds, not ECS. `Application.pick` translates CSS coordinates and validates the returned snapshot generation. These queries require no GPU readback and do not implement triangle collision.

`prepareMesh` is pure CPU canonical packing shared by worker and main paths. Large worker results transfer prepared storage; upload publication owns transactional rollback and bounded vertex/index queue writes. Environment workers produce CPU bake definitions, while versioned offline archives bypass convolution. Recovery retains CPU definitions. Worker startup, uploads and target allocation remain cold lifecycle work.

`HDRRendering` owns optional linear scene presentation. `HDRPostEffects` owns bounded bloom/luminance pyramids, persistent exposure state and compute pipelines. The graph orders color → post-processing → tone mapping. Ordinary effects frames update existing parameter buffers and encode GPU work without allocation, waits or readbacks; configuration/resize prepares resources. FXAA filters mapped linear output before the final sRGB attachment encoding. All new effects default off.

Input helpers own DOM capture/poll state and are disposed by gameplay. Camera controllers receive gameplay positions/deltas and call the existing Camera setters. They never query ECS from render passes, allocate GPU resources, or alter geometry/deformation layouts. The collect example demonstrates their subscription/teardown boundaries.

## Maintenance seams after game integration

Keep setup and lifetime decisions separate from frame arithmetic. `AnimationBindings` defines controller-owned pose/binding records and resolves layer masks/reference poses; `Animator` retains original binding construction, rest capture, playback, sampling cursors, crossfades and tight composition/write loops. `MorphState` remains exported from Animator for existing callers. Shared clips never own per-controller cursor state.

`createRendererResources` builds shared buffers and pass owners in their original GPU construction order. Renderer exposes the same object identities and owns disposal. Its frame methods separate shared writes, optional GPU-path preparation and upload statistics; they create no contexts or arrays per frame. Application similarly names `prepareScene` and `submitFrame`, keeping profiler spans, fixed simulation dispatch and one submission intact. Picking scratch lives in `ApplicationPicking`, which wraps renderer snapshot queries with application-side identity validation.

`createPostPipelines` owns reduction/adaptation shader variants; `createPresentationPipeline` owns the two fullscreen binding/pipeline variants. HDRRendering/HDRPostEffects retain targets, parameters, exposure state, bind groups and encoding. Factories run on cold configuration boundaries; resizing replaces targets without rebuilding pipelines. Generated reduction arithmetic is unchanged, with named WGSL intermediates for clarity.

AssetWorkerProtocol and EnvironmentWorkerProtocol define both ends of their transfer contracts. AssetDecoder separates worker startup, reply restoration and failure handling from request dispatch/cancellation. IDs remain monotonically allocated, cancelled/retired replies are ignored, and a failed worker can be recreated. There is no generic job scheduler or new worker lifecycle policy.

InputScope records only listener registrations during setup, handles focus/visibility clearing and removes exactly its subscriptions during teardown. Gesture owners retain pointer capture, touch styles and accumulated state. Disposal preserves unrelated listeners and each input's existing focus behavior.

Small math, ECS stores, sampling kernels, visibility structures, mesh preparation, GPU caches and WGSL pass modules retain their focused responsibilities. Extend these seams when adding features; avoid moving hot arithmetic behind generic callback/context abstractions. `benchmarks/MAINTENANCE_REPORT.md` records validation and comparison with the committed game-improvement baseline.

## Code quality tools

ESLint's flat config covers TypeScript and JavaScript with recommended correctness rules. Prettier owns formatting; eslint-config-prettier disables competing style rules. WGSL uses the existing token-preserving formatter. Validation runs lint before formatting, tests and build. `tools/lint` owns a locked TypeScript 6 parser runtime because typescript-eslint's supported peer range excludes the project's TypeScript 7 build compiler. The pnpm workspace installs that isolated package alongside the root using one committed lockfile; ordinary runtime/build imports do not reference it.

## Function documentation

Implemented TypeScript/JavaScript functions, constructors, accessors and callbacks have adjacent explanations, as do WGSL helpers and entry points. Named functions use JSDoc; anonymous callbacks use a first-body comment or an inline expression comment. Interface methods describe the ownership contract callers depend on. Keep comments synchronized with behavior, especially coordinate spaces, units, cancellation, resource lifetime, dirty tracking and cold versus frame work. The game integration walkthrough is [GAME_DEVELOPMENT_GUIDE.md](GAME_DEVELOPMENT_GUIDE.md).

## Custom surface shader families

MaterialShaderRegistry retains immutable validated CPU definitions; MaterialManager stores stable family IDs and a separate 16-float parameter row without changing the 80-byte PBR ABI. ColorPass serializes cold registration and owns lazily allocated shared parameter storage plus bounded color/HDR/environment pipeline tables. Compatible families reuse layouts/frame bind groups. The shared vertex path and renderer-owned alpha coverage keep depth/shadows consistent. Family IDs participate in queue/batch sorting and indirect metadata selection, using 16-bit pipeline storage. Recovery replays committed definitions against the replacement device. No custom GPU objects are created by upload or encode. The public surface-only contract and limitations are documented in CUSTOM_MATERIALS.md.
