# Codebase guide

`IMPLEMENTATION_PLAN.md` defines feature scope, architecture, and performance rules. `PROGRESS.md` records implementation evidence and the user's amendment making Phase 44 optional. This guide describes the code organization and where to make changes.

## Start reading here

1. `src/main.ts` creates the browser application.
2. `src/app/Application.ts` owns startup, shutdown, resize observation, asset instantiation, and simulation order.
3. `src/rendering/RenderExtractor.ts` copies ECS state into the persistent `RenderWorld` snapshot.
4. `src/rendering/Renderer.ts` prepares visibility, sorts batches, uploads shared frame state, and executes the render graph.
5. `src/rendering/graph/configureRenderGraph.ts` declares pass dependencies. Individual pass classes encode the GPU work.

## Module ownership

| Directory                                  | Responsibility                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `src/app`                                  | Browser lifecycle and frame orchestration                                                                      |
| `src/ecs`                                  | Gameplay entities, component arrays, transform/animation/skeleton/bounds systems                               |
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

The application updates animation, world transforms, joint palettes and conservative animated bounds, then extracts render state. Renderer passes consume `RenderWorld`; they do not query ECS stores.

`Renderer.encode()` makes the preparation order explicit:

1. Resize-dependent resources update when dimensions change.
2. `configureFeatureDependencies()` enables prerequisites for requested optional paths.
3. `prepareVisibility()` updates the camera, selects CPU visibility/LOD, and records statistics. GPU indirect submission defers object selection to compute passes.
4. `prepareBatches()` builds the queue, sorts pipeline/material/mesh runs, and groups instances.
5. `uploadFrameState()` fills persistent staging arrays, advances the arena slot, uploads dirty shared records, and prepares optional GPU paths.
6. The compiled graph encodes all enabled work; the application submits one command buffer.

The compiled graph order is GPU frustum → shadows → light clusters → depth → geometry clusters → Hi-Z → GPU occlusion → GPU LOD → compaction → indirect arguments → color → Hi-Z debug. Optional pass callbacks may do no work. Resource names describe explicit versions/dependencies, not a transient resource allocator.

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

Resize allocation, asset loading and first supported enable of optional geometry optimization are cold paths. Streaming eviction and whole-asset unloading wait for submitted work asynchronously outside the frame loop. `AssetInstances` tracks application-created nodes/primitives and retained cache leases. Unloading vetoes external consumers before removal, retires controllers/skins/morph states, refreshes extraction synchronously, then fences GPU resources. Shared texture reference counts preserve other assets. Cold registry compaction remaps ECS IDs; arena offsets and live views remain stable. World entity IDs stay monotonic.

`AssetLoader` passes abort signals through fetch, decode and upload. Worker jobs remove cancelled callbacks without terminating other jobs. Uploads recheck signals at yield boundaries. LRU cache budgets protect retained/pending/latest loads; application byte accounting deduplicates decoded backing buffers. Failure metadata/history are bounded and failed cleanup retains ownership for retry. `Application.dispose()` is asynchronous and cancels/cleans assets before destroying the device.

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
npm run benchmark -- --outputJson artifacts/benchmarks.json
npm run benchmark:gpu
```

Prettier formats supported source/configuration/docs. `scripts/format-shaders.mjs` formats WGSL whitespace and verifies token preservation before writing. Generated assets, benchmark evidence, the source plan and historical progress log are excluded from automatic formatting.

`validate-gpu.mjs` owns browser lifecycle and smoke orchestration. `gpu/smoke-checks.mjs` contains camera/resource/loading/worker/draw diagnostics. `gpu/regression-scene.mjs` retains one integrated scene because the checks deliberately exercise state changes and shared asset lifetimes; its helpers must stay inside the serialized browser callback. `gpu/regression-assertions.mjs` validates the report in Node. The matrix uses the corresponding benchmark scenario and assertions modules. Browser callbacks cannot close over Node imports: Playwright serializes their function source.

GPU harnesses require installed Chrome and a WebGPU adapter. Readbacks and completion waits are intentional diagnostic operations. Benchmark timings depend on the machine, scheduling and warmup; compare resource counts, work performed and image/reference correctness alongside timing. A refactor does not establish a universal speedup.
