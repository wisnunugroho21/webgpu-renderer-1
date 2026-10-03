# Implementation progress

Source of truth: `IMPLEMENTATION_PLAN.md`, copied from the supplied document. On 2026-10-03 the user explicitly amended Phase 44 to allow an optional feature before benchmark justification; both the repository plan and supplied source were updated.

Repository audit: initially empty; no implementation or existing tests. Execute numbered phases in order, with validation gates before advancing. Future measurement-gated optimizations require benchmark evidence.

## Phase 1 — validated

- Vite, strict TypeScript, Vitest, canvas, GPU initialization, resize, device-loss handling, frame loop.
- `npm test`: 3 passing tests. `npm run build`: passing.
- `npm run validate:gpu`: actual Chrome WebGPU execution, 157 frames, no uncaptured or scoped validation errors.
- Clear pixel BGRA `[36, 20, 10, 255]`; resize to 1280×960 physical pixels at DPR 2; device destruction handled and rendering stopped.
- Baseline CPU encoding: median 0.10 ms, p95 0.20 ms. These are CPU measurements in headless Chrome, not GPU timings or a portable performance guarantee.
- Raw local results: `artifacts/phase-1.json`; screenshot: `artifacts/bootstrap.png`.

## Phase 2 — validated

Indexed cube, depth testing, back-face culling, perspective camera.

- Build/tests passed. Real Apple Metal WebGPU: cube front-center BGRA `[255,166,51,255]`, background unchanged, screenshot visually inspected.
- 156 frames, zero GPU errors; resize and device loss passed. CPU encoding median 0.10 ms, p95 0.30 ms.
- Harness failure (overlapping mapped range requests) fixed before advancing; rerun passed.
- Raw results: `artifacts/phase-2.json`.

## Phase 3 — validated

Allocation-free output math, bounds/frustum primitives, camera with persistent matrices and frame uniform buffer. Standard Z [0,1], right-handed column vectors.

- 12 unit tests passed; build passed; actual GPU pixels/resize/loss passed.
- 100 camera moves: zero buffer creations, persistent frame buffer, changed view-projection verified.
- CPU encoding median 0.10 ms, p95 0.30 ms. Math baseline: 10,000 multiplies mean 0.2732 ms; 1,000 dirty camera updates mean 0.1542 ms.
- Raw results: `artifacts/phase-3.json`.

## Phase 4 — validated

Shared resource ownership, shader/pipeline/sampler caching, creation/live-count/cache metrics.

- 15 tests and build passed; actual WebGPU cube/resize/device loss passed with zero errors.
- 100 camera moves produced no persistent resource creation. One pipeline and one shader module.
- 100 direct pipeline creations: 0.6 ms; 100 descriptor cache lookups: 2.8 ms. Canonicalization overhead dominates this small case; no cache lookups run in the frame loop, which retains resolved pipelines. No speedup claimed.
- Raw results: `artifacts/phase-4.json`.

## Phase 5 — validated

Triple-buffered shared arena; aligned camera, object, material and instance data. Overflow fails explicitly; no per-object GPU buffers or frame-path readbacks.

- 18 tests passed; build and GPU regression passed. CPU encoding median 0.10 ms, p95 0.20 ms.
- Actual GPU API benchmark: 10,000 per-object buffer creations/uploads 8.9 ms versus shared staging/upload 1.5 ms, 640,000 bytes, zero new shared buffers.
- CPU-only staging mean 0.3177 ms versus separate typed-array allocations 0.2621 ms; shared CPU staging is not claimed to be faster. Benefit demonstrated at GPU resource/submission boundary.
- Benchmark callback type failure repaired and build/benchmark rerun before advancing. Raw results: `artifacts/phase-5.json`.

## Phase 6 — validated

Numeric entity world, core SoA component stores, linked transform hierarchy, iterative dirty propagation/update. Fixed capacity with explicit overflow; IDs are monotonic to avoid stale-ID reuse.

- 24 tests/build/GPU regression passed, including 10,000-depth hierarchy and remove/re-add queue safety.
- Exactly 100 transforms recomputed among 10,000; unaffected matrices byte-for-byte unchanged.
- Dirty benchmark mean 0.0106 ms versus full update 0.8030 ms (75.9× in this CPU run). JSON benchmark output saved under `artifacts/benchmarks.json`.

## Phase 7 — validated

Compact independent RenderWorld snapshots; render passes read only RenderWorld, shared GPU matrix storage, conservative world-space bounds including shear.

- 26 unit tests/build/actual GPU checks passed. Renderer has no ECS imports.
- 10,000 renderable extraction baseline mean 0.7526 ms. CPU frame median 0.10 ms, p95 0.20 ms in cube scene.
- Raw results: `artifacts/phase-7.json`.

## Phase 8 — validated

Shared material storage/uploads, initial glTF-style scalar properties, controlled flags and prewarmed alpha/cull pipeline states. Metallic/roughness storage precedes Phase 14 PBR shading.

- 29 tests/build/benchmarks passed. Four unique pipelines, one shader module; six bounded alpha/cull combinations reuse opaque/mask pipeline state.
- Actual GPU pixel checks passed for tint, mask discard and alpha blend with zero validation errors.
- Creation benchmark means: 1 material 0.0002 ms; 100 materials 0.0122 ms; 1,000 materials 0.1461 ms (noisy, ±10.45%).
- Raw results: `artifacts/phase-8.json`.

## Phase 9 — validated

Persistent opaque/mask/transparent queues, state-first opaque sorting and view-depth transparency sorting; draw/switch/upload metrics.

- 34 tests, build, GPU material/pixel/lifecycle validation passed.
- 10,000 interleaved objects reduce to exactly 1/100/1,000 material runs; transparency is back-to-front by camera-space depth.
- Queue build/sort baseline means: 1 material 1.8691 ms; 100 materials 1.4797 ms; 1,000 materials 1.3292 ms. CPU encoding median 0.10 ms in cube regression.

## Phase 10 — validated

Contiguous compatible batches and shared eight-u32 instance records, indexed instanced draws. Diagnostic individual/sorted modes retain transparency depth sorting.

- 36 tests/build passed. Actual 10,000-cube images match bit-for-bit across individual/sorted/instanced modes, six shared GPU buffers and no new persistent resources.
- Initial instanced CPU median 1.5 ms vs individual 0.8 ms exposed redundant sorting. Added sorted-input detection; revalidated images/tests and benchmark.
- Final median CPU submission: individual 0.9 ms / sorted 1.1 ms / instanced 0.7 ms. Draw calls 10,000 / 10,000 / 1. GPU completion waits/readbacks occur only in the stress harness.
- Raw results: `artifacts/phase-10.json`; visually checked `artifacts/10000-cubes.png`.

## Phase 11 — validated

Reusable visible-index arrays, AABB/sphere plane tests, conservative numerical boundary handling; render queues consume the visible subset.

- 38 tests/build passed; actual GPU offscreen case rejected 1 object and issued zero draws; 10,000 visible cubes still match between submission modes.
- Stress harness swap-chain readback lifetime failure fixed by encoding the copy in the draw submission; rerun passed with no validation errors.
- 100,000 objects: no-culling enumeration mean 0.0757 ms, CPU sphere 1.0024 ms, CPU AABB 1.3393 ms. Enumeration omits draw work and is not a total-frame comparison.

## Phase 12 — validated

Flat-array static BVH, bulk acceptance/subtree rejection, separate dynamic list, static snapshot invalidation. Linear culling remains available; BVH opt-in until benchmark comparison.

- 41 tests/build/GPU regression passed. Linear and BVH full-image checksums match for 10,000 static cubes; root bulk acceptance tests one node and zero individual bounds.
- 100,000 static bounds: BVH mean 0.0231 ms versus linear AABB 0.9594 ms (41.6× query improvement, excludes construction).
- Fully visible live scene: BVH CPU median 1.9 ms versus linear instanced 1.0 ms because spatial traversal order requires sorting. Keep linear default, BVH opt-in; no universal speedup claimed.
- Raw results: `artifacts/phase-12.json` and `artifacts/benchmarks.json`.

## Phase 13 — validated

glTF Transform core handles glTF/GLB container/accessor decoding. Conversion produces independent runtime mesh, node, material, texture/sampler, camera, animation, skin and morph data. Shared mesh upload and scene instantiation use engine resource managers and ECS. All seven primitive modes convert to triangle/line/point lists.

- 51 unit tests and production build passed. Actual Chrome WebGPU validation passed against both development server and production preview, including an asynchronously loaded GLB triangle with expected BGRA `[255,51,178,255]` and zero validation errors.
- Decoder baseline: 10,000 vertices mean 1.2477 ms without explicit indices; final valid indexed fixture (9,999 triangle-list indices) mean 1.7073 ms, median 1.6718 ms. Saved in `benchmarks/results/cpu-benchmarks.json`.
- Parser tests cover GLB and JSON/resources, normalized attributes, hierarchy, materials/texture samplers, cameras, animation channel data, default inverse binds, node/mesh morph weights and malformed containers. Primitive conversion tests cover all modes.
- One shader module and eight unique prewarmed pipelines for the bounded alpha/cull/topology combinations; no pipeline construction during rendering.
- Vite's first late dependency import initially reloaded the page. Added explicit prebundling and the public `Application.loadAsset` API; development and production GPU regression then passed.
- Runtime animation, skinning/morph deformation, textured PBR shading and texture mipmaps belong to subsequent phases and are not marked complete here.

## Phase 14 — validated

One shared Cook–Torrance metallic-roughness shader, bounded alpha/cull/topology pipelines, shared 80-byte material records and cold-path texture bind groups. Meshes carry vertex alpha, normals, tangents and two UV sets. Missing triangle normals generate flat faces at upload; inverse-transpose normal transforms handle nonuniform scale. All five glTF material maps, factors, alpha modes and double-sided surfaces are active. Shader outputs linear color to an sRGB view for correct blending.

- 54 unit tests, production build and real Chrome WebGPU regression passed with zero scoped/uncaptured errors.
- Textured GLB checks cover normal/metallic/roughness/AO effects, exact emissive sRGB roundtrip, TEXCOORD_1, alpha masking, linear-space blending, and single/double-sided back faces.
- 10,000 PBR cubes: individual CPU median 1.3 ms, sorted 1.4 ms, instanced 1.1 ms, BVH 2.0 ms; all full-image checksums agree. Instancing remains one draw, 120,000 triangles; no steady-state resource creations. Timings are CPU encoding, not GPU timestamps.
- Raw results: `benchmarks/results/phase-14.json` and `benchmarks/results/phase-14-cpu.json`. Mipmaps/cross-asset texture deduplication are Phase 15.

## Phase 15 — validated

Asynchronous image decode, content-hash texture cache keyed by color space, full GPU-generated mip chains, shared samplers and compatible-filter anisotropy. Odd dimensions use area-weighted downsampling; color maps decode/filter/encode in linear light, data maps stay linear. Failed decode entries are removed for retry; disposal guards pending loads. Compressed texture formats remain deferred as the plan specifies.

- 55 unit tests/build passed. Isolated real Chrome production-preview validation passed with zero GPU errors, including all Phase 14 PBR checks.
- Concurrent cross-role/asset loads: one decode, two GPU textures (linear/sRGB), zero creations on cached loads; failed images reject twice with no retained cache entries.
- 3×5 image -> three mip levels -> final linear RGBA [85,85,85,255], sRGB RGBA [156,156,156,255].
- Tiny image cold preparation 0.6 ms; cached median below browser timer resolution, p95 0.1 ms over 30 samples. This includes async hash/bind-group preparation and is not a GPU timestamp or representative large-asset throughput. 10,000-cube instanced CPU encoding remains 1.1 ms median.
- Harness corrected to own a Vite process on isolated port 5187 and require its readiness; previous port-5173 runs could attach to an existing development server. Phase 14 checks were rerun successfully in confirmed production preview.
- Raw results: `benchmarks/results/phase-15.json` and `benchmarks/results/phase-15-cpu.json`.

## Phase 16 — validated

AnimationClip/Channel/Sampler and independent Animator instances, STEP/LINEAR/CUBICSPLINE sampling, shortest-path quaternion SLERP and normalized cubic quaternion output. Playback supports play/pause/stop/loop/speed/seek. Persistent sampling outputs update ECS TRS and node-shared morph state before transforms/extraction. GPU deformation remains for later phases.

- 62 tests and production build passed. Real production-preview GPU regression passed, including animated GLB TRS/morph outputs, hierarchy propagation and endpoint frustum rejection.
- Tests cover exact keys/endpoints, tangent interval scaling, antipodal quaternions, playback/reverse/loop controls, independent instances, destroyed targets and invalid data.
- Shared TRS clip sampling: 100 animators mean 0.0399 ms; 1,000 mean 0.3866 ms; 10,000 mean 3.9753 ms. This excludes transform hierarchy updates/GPU rendering.
- Raw results: `benchmarks/results/phase-16.json` and `benchmarks/results/phase-16-cpu.json`.

## Phase 17 — validated

Shared SkeletonAsset bind/hierarchy data, independent SkeletonInstance pose/matrix data and numeric ECS skin references. SkinVertexData retains/validates JOINTS_0/WEIGHTS_0, supports optional second influence streams, normalizes weights once during loading and validates joint ranges. No character owns a GPU joint buffer.

- 66 tests/build passed. Production WebGPU GLB regression confirms two instances share one skeleton asset, retain independent matrices and expose distinct render skin IDs; normalized integer weights survive decoding.
- Static influence validation/copy/normalization for 10,000 vertices: mean 0.5424 ms (cold path).
- Raw results: `benchmarks/results/phase-17.json` and `benchmarks/results/phase-17-cpu.json`.

## Phase 18 — validated

SkeletonSystem runs after animation and transform hierarchy updates. Column-vector skinning convention is `inverse(meshWorld) * jointWorld * inverseBind`; mesh inverses and per-joint views are persistent, and unchanged joint matrices are skipped. Singular mesh transforms and removed live joints fail explicitly.

- 71 tests/build/production GPU regression passed. Tests cover bind-pose world reconstruction, nonidentity mesh transforms, joint/mesh motion, unchanged ranges and projective matrix inversion.
- 100 skeletons × 64 joints: unchanged mean 0.1096 ms; all changed mean 0.6027 ms (CPU palette update, excludes hierarchy).
- Raw results: `benchmarks/results/phase-18.json` and `benchmarks/results/phase-18-cpu.json`.

## Phase 19 — validated

One persistent shared GPU joint matrix buffer, contiguous numeric instance ranges, independent render snapshots, changed-range coalescing and upload metrics. Instance records carry jointOffset/jointCount; ECS remains outside rendering. Pending snapshot dirtiness survives repeated extraction until upload.

- 73 tests/build/production GPU regression passed. Two skeleton palettes read back exactly; full upload 256 bytes, unchanged upload 0, shared-joint change 128 bytes in two writes, no new resources.
- 6,400-joint CPU range staging with a mock queue: unchanged mean 0.0066 ms, all dirty 0.0112 ms, 100 sparse changes 0.0143 ms. These are not GPU write timings.
- Raw results: `benchmarks/results/phase-19.json` and `benchmarks/results/phase-19-cpu.json`.

## Phase 20 — validated

Four-weight GPU skinning reads shared palette ranges and applies the blended transform to position, inverse-transpose normal and tangent. Mixed static/skinned instances use one material shader and bounded pipelines. Vertex data uploads once; animation updates matrices only. Optional secondary influence streams are retained in static parsing but fail explicitly on GPU upload until an eight-weight variant is implemented.

- 73 tests/build/production GPU regression passed. Rotated skin position/normal/tangent output exactly matches the static reference BGRA [101,101,101,255]; joint translation changes GPU geometry without vertex-buffer writes.
- 1,000 instanced triangles with a shared two-joint palette: one draw, CPU encoding median 0.2 ms/p95 0.2 ms, zero resource creations. This is a shared-pose microbenchmark, not a full character/GPU-time result.
- Raw results: `benchmarks/results/phase-20.json` and `benchmarks/results/phase-20-cpu.json`.

## Phase 21 — validated

Validated static POSITION/NORMAL/TANGENT target deltas, shared node-instance weight arena with weightOffset/targetCount, mesh defaults and node overrides. Multiple primitives share a node's state; different nodes have independent ranges. Negative finite weights are supported.

- 76 tests/build/production GPU regression passed. Initial node override 0.1 and mesh default 0.2 occupy separate ranges in one weight arena; GLB target geometry retains position deltas.
- Four targets × 10,000 vertices × three streams validation: mean 1.9881 ms. Allocate 1,000 independent four-weight states: mean 0.0361 ms (cold preparation).
- Build initially caught two test type errors; repaired and reran all gates before advancing.
- Raw results: `benchmarks/results/phase-21.json` and `benchmarks/results/phase-21-cpu.json`.

## Phase 22 — validated

One shared MorphWeightBuffer and separate shared MorphPositionDeltaBuffer/MorphNormalDeltaBuffer/MorphTangentDeltaBuffer, with target-major vec4-aligned deltas. Missing streams are zero-filled. Render snapshots compare scalar weights and coalesce only changed ranges; metrics expose active state/target counts and upload bytes.

- 78 tests/build/production GPU regression passed. GPU delta/weight readback matches CPU values; a one-weight change uploads 4 bytes, unchanged frames upload 0.
- 4,000-weight CPU staging with mock queue: unchanged mean 0.0040 ms, all changed mean 0.0067 ms.
- Raw results: `benchmarks/results/phase-22.json` and `benchmarks/results/phase-22-cpu.json`.

## Phase 23 — validated

Vertex shader accumulates weighted position/normal/tangent deltas from shared buffers before subsequent transforms. Persistent 48-byte instance records include mesh delta offset/vertex stride and independent weight ranges. Normals and tangents normalize after transformation; no CPU morph deformation occurs in frames.

- 78 tests/build/production GPU regression passed. Two targets with weights 0.5/-0.25 match the static reference exactly at BGRA [109,109,109,255]. A changed weight moves GPU geometry, with zero vertex-buffer rewrites.
- 1,000 instanced triangles/two shared targets: one draw, CPU encoding median 0.1 ms/p95 0.2 ms, no resource creations, zero unchanged weight uploads.
- GPU validation initially exposed the old 32-byte arena allocation after records grew to 48 bytes. Corrected and reran every gate.
- Raw results: `benchmarks/results/phase-23.json` and `benchmarks/results/phase-23-cpu.json`.

## Phase 24 — validated

Shared common/morphing/skinning WGSL helpers implement base -> morph -> skin -> model -> view/projection. The current color/depth attachment consumes the same vertex deformation; later dedicated shadow/depth passes must use this shared entry point. Those later passes are not claimed implemented here.

- 78 tests/build/production GPU regression passed. Combined weighted morph + rotated skin matches static reference BGRA [94,94,94,255].
- 1,000 combined instances: one draw, CPU median 0.1 ms/p95 0.2 ms, no resource creations or unchanged deformation uploads.
- Raw results: `benchmarks/results/phase-24.json` and `benchmarks/results/phase-24-cpu.json`.

## Phase 25 — validated

Conservative animated bounds expand base boxes by signed morph delta extrema, then union joint-transformed boxes. Positive normalized skin weights ensure their convex blends stay enclosed; numerical padding prevents Float32 shrinkage. Bounds update after palettes and before extraction; no frame-time vertex traversal. Static/BVH invalidation consumes the same updated snapshot bounds.

- 81 tests/build/production GPU regression passed. An offscreen mesh bind pose still renders its visible deformed geometry with linear/BVH culling; joint motion offscreen rejects both objects and issues zero draws. Unit tests check enclosure across positive/negative morph weights and convex skin blends.
- 100 objects × 64 joint boxes: mean 0.1280 ms, independent of mesh vertex count (excludes palette/hierarchy update).
- Raw results: `benchmarks/results/phase-25.json` and `benchmarks/results/phase-25-cpu.json`.

## Phase 26 — validated

Persistent component-space AnimationPose values, override blending, reference-relative local additive operations, layer descriptors and crossfade playback. Translation/scale/morph blend as components; quaternion rotations use SLERP and multiplication. Crossfade supports pause/seek, rest fallback for missing channels and smooth interruption. Layer playback beyond the initial active clip/crossfade is a future extension.

- 86 tests/build/production GPU regression passed. Two-clip GLB crossfade yields expected ECS translation -2.5, scale 0.5, rotation 45 degrees and morph weight 0.75; all existing deformation/bounds checks pass.
- 10,000 persistent quaternion pose blends: mean 0.8422 ms.
- Raw results: `benchmarks/results/phase-26.json` and `benchmarks/results/phase-26-cpu.json`.

## Phase 27 — validated

Physical-pixel projected sphere LOD, persistent entity-keyed hysteresis, authored compatible mesh groups, tiny-object culling and distribution metrics. Selection precedes sorting/batching; variants must fit base geometry/morph envelopes so culling remains conservative.

- 90 tests/build/production GPU regression passed. Camera distances 5/20/40/80 select LOD 0/1/2/cull, drawing 12/8/1/0 triangles; no frame-time resource creations. Unit tests verify two-way threshold jitter and independent visibility ordering.
- 10,000 LOD candidates with persistent history: mean 0.1986 ms.
- Raw results: `benchmarks/results/phase-27.json` and `benchmarks/results/phase-27-cpu.json`.

## Phase 28 — validated

Directional, point and spot lights, typed ECS properties, transformed compact render snapshots and one shared GPU light buffer. Point/spot lights use inverse-square attenuation, smooth finite range cutoff and squared spot-cone attenuation. Light changes never create per-light bind groups.

- 92 tests/build/production GPU regression passed. Directional color, inverse-square ratio, range/spot cutoff and zero-light ambient checks passed; no resource/bind-group creations during light changes.
- 1,000-light snapshot extraction/comparison mean 0.0646 ms.
- Many-light microbenchmark at 1280×960: 1/64/256/1024 bounded point lights have median submission-to-completion latency 0.6/2.7/7.7/30.9 ms. CPU encoding stays 0–0.1 ms. Completion timings include CPU submission/browser scheduling and are not timestamp-query GPU times. The 1,024-light cost justifies Phase 29 clustering.
- Raw results: `benchmarks/results/phase-28.json` and `benchmarks/results/phase-28-cpu.json`.

## Phase 29 — validated

GPU compute assigns bounded lights to logarithmic depth clusters using shared fixed metadata/index buffers. Fragment lighting walks compact lists; overflow falls back to the full light loop. Auto mode enables clustering only for measured many-light cases. Large viewports coarsen tiles within fixed capacity; pipelines/bind groups are prepared outside frames.

- 94 tests/build/production GPU regression passed. Full-light and clustered images match every byte; 65 overlapping directional lights force overflow and still match every byte.
- Controlled 1,024-point-light comparison at 1280×960: completion median 31.6 ms off / 1.5 ms on. CPU encoding 0–0.1 ms. Mean 1.82 candidates per cluster, maximum 11. Timings include browser submission/scheduling, not timestamp-query GPU times.
- No resource creations during dispatch, toggles or light updates.
- Raw results: `benchmarks/results/phase-29.json` and `benchmarks/results/phase-29-cpu.json`.

## Phase 30 — validated

Directional shadow maps, independent light-frustum culling, multiple casters/lights, 1–4 practical cascades and exact static-map caching. One fixed 16-layer 1024² depth array covers up to four directional lights; no per-light/character resources. OPAQUE/MASK depth uses the same base -> morph -> skin -> model WGSL function as color. Alpha-blended surfaces do not cast opaque depth. Shadow distance defaults to 30; standard Z, slope depth bias and 3×3 comparison filtering.

- Each successive stage passed tests/build/real production WebGPU regression before advancement. Final 99 tests pass. Receiver shadow BGRA [48,48,48,255] vs lit [216,216,216,255]; masked caster restores lit pixel. Shadow-frustum culling preserves every image byte; combined morph/skin caster matches static reference every byte.
- Separate light layers and four cascades validated. Cached frames skip all four depth passes and upload zero shadow metadata; movement and material alpha changes invalidate correctly. Unit checks cover joint/weight/mesh/membership invalidation. No warm-frame resource creations.
- 10,000 bounds: fit 0.0468 ms, frustum cull 0.3070 ms, exact unchanged-caster cache comparison 0.7896 ms. Small-scene completion median: shadows off 0.8 ms / one map 1.3 ms / four cascades 1.4 ms / cached cascades 1.1 ms (browser completion, not timestamp GPU time).
- Fixed shadow texture storage is 64 MiB; dynamic arenas increased from 2 to 4 MiB each to accommodate full shared camera and shadow instance pools. Cold cache snapshots are persistent CPU storage.
- Initial GPU checks exposed receiver self-shadowing, and WebGPU rejects depth bias for line/point topology. Applied slope bias only to triangle pipelines and reran all checks. A multiple-caster fixture sample was corrected to view the floor without another cube occluding it.
- Raw results: `benchmarks/results/phase-30.json` and `benchmarks/results/phase-30-cpu.json`; intermediate stage reports remain in local artifacts.

## Phase 31 — validated

A compiled render graph represents passes, reads, writes and explicit dependencies. Current shadow depth, light clustering and color passes execute through a persistent topological schedule. Cold validation rejects missing inputs/dependencies, duplicate resource writers, feedback and cycles; resource versions make future write chains explicit. Temporary-resource reuse remains a later extension as specified by the plan.

- 102 tests/build/production GPU regressions passed. Schedule is shadows -> light-clusters -> color; all previous image, cache, deformation and resource checks pass.
- Eight compiled no-op passes × 10,000 executions average 0.2171 ms (CPU schedule overhead only).
- Raw results: `benchmarks/results/phase-31.json` and `benchmarks/results/phase-31-cpu.json`.

## Phase 32 — validated

Fixed circular CPU timings for simulation (currently no simulation work), animation, transforms, skeletons, animated bounds, extraction, culling/LOD, sorting/batching and command encoding. Renderer counts include active animators, deformation uploads, visibility, draw/state changes, and shadow work. Optional adapter timestamp-query support is requested at initialization; opt-in pass timestamps use three fixed capture slots, dropping additional captures when full. Explicit paused `readSamples()` is the only profiler readback; normal frames never map/wait.

- 105 tests/build/production GPU regressions passed. Metal reports timestamp support; three captured frames contain 18 shadow/cluster/color intervals, all finite/nonnegative. Fourth capture drops safely; no resource creations during capture/readback. Unsupported devices allocate no query resources.
- Record nine CPU stages × 10,000 frames: mean 5.7033 ms, about 0.00057 ms/frame overhead. GPU timestamps show 65,536 ns quantization on this adapter; warm samples are preferred to the first capture.
- Raw results: `benchmarks/results/phase-32.json` and `benchmarks/results/phase-32-cpu.json`.

## Phase 33 — validated

Optional camera depth prepass reuses shared deformed depth shader/bind groups, visible instance ranges and alpha masking. BLEND is excluded from depth and retains ordered color blending. Color loads prepass depth with a prepared less-equal pipeline variant; all pipelines are cold-cached. Render graph represents the depth resource version explicitly.

- 106 tests/build/production GPU regressions passed. Full images match exactly with prepass on/off, including MASK/BLEND and combined morph/skin.
- Completion median at 1280×960: simple 0.8 ms off / 1.0 ms on; 32-layer overdraw 5.7 / 1.3 ms; 32 layers × 128 lights (full light loop) 317.5 / 12.9 ms. CPU encoding remains 0–0.1 ms. Default stays off because simple scenes regress. These are browser completion timings.
- No resource creation while toggling or drawing. New unit check verifies batch range submission and blend exclusion; GPU benchmark includes all three required workloads.
- Raw results: `benchmarks/results/phase-33.json` (correctness and GPU workload benchmarks).

## Phase 34 — validated

Standard WebGPU Z [0,1] with conservative maximum-depth reduction. Compute copies depth into r32float mip 0, then reduces isolated mip views in ordered passes. Odd dimensions use overlapping integer footprints so edge samples are never omitted. Debug view displays a selected mip without readback. Pyramid resources/groups resize with the viewport; dispatch does not allocate. Disabled by default until visibility consumes it.

- 107 tests/build/production GPU checks passed. Every reduced texel across the 1280×960 pyramid matches a CPU reference exactly. A 5×3 fixture reduces to 2×1 and 1×1, preserving farthest depth 0.36 and first footprint 0.26; full-resolution background yields top depth 1. Debug output agrees.
- Eleven-mip GPU timestamp sums: 0.3277 / 0.1311 / 0.5243 ms (adapter quantization). Completion median in the existing expensive alpha fixture: 25.3 ms off / 25.8 ms on; CPU 0.2 / 0.3 ms. No warm resource creations.
- Raw results: `benchmarks/results/phase-34.json`.

## Phase 35 — validated

Shared 32-byte GPUObject records hold world spheres and numeric mesh/material/transform/flags. A prewarmed compute pass tests one object per invocation, writing persistent visibility flags. Changed object spans upload; unchanged snapshots upload zero. Sphere tests use unnormalized WebGPU clip planes and conservative uncertainty margin. Opt-in diagnostic compute currently runs alongside CPU submission; visibility consumption belongs to later compaction/indirect phases.

- 108 tests/build/production GPU regressions passed. GPU and CPU sphere flags agree for all 100,000 candidates (14,954 visible) and the live scene. Near/far tangencies and a camera-intersecting sphere stay visible; outside/far candidates reject.
- 100,000 candidates: CPU sphere cull median 2.2 ms, GPU submission-to-completion 0.8 ms. Initial object snapshot preparation/upload takes 9.7 ms and 3,200,016 bytes; unchanged live snapshots upload 0. GPU figure excludes snapshot preparation and cannot alone establish end-to-end speedup. No warm resource creations.
- Raw results: `benchmarks/results/phase-35.json`.

## Phase 36 — validated

GPU occlusion refines frustum flags using projected conservative sphere boxes, a suitable maximum-depth Hi-Z mip, and every touched texel. Camera/near-plane intersections remain visible; a depth margin favors false visibility. Current color depth produces the hierarchy before diagnostic occlusion. Enabling occlusion enables its frustum/Hi-Z prerequisites. Results remain GPU-only until subsequent compaction/indirect phases consume them.

- 109 tests/build/production GPU checks passed. A wall hides the rear object while exposed geometry survives. Near-plane, foreground, huge/camera-containing and offscreen cases behave conservatively. 100,000 candidates match an independent CPU projection/Hi-Z reference exactly: 85,627 rejected, zero false-invisible results.
- Frustum + occlusion completion median 0.4 ms for 100,000 candidates with a prepared hierarchy. CPU validation reference takes 97.3 ms but allocates diagnostic scratch arrays and is not an optimized runtime baseline. Snapshot upload and depth generation are excluded from compute timing. No resources created during warm dispatch.
- Raw results: `benchmarks/results/phase-36.json`.

## Phase 37 — validated

Initial atomic append writes GPU-visible object IDs into one persistent VisibleInstanceBuffer and a bounded counter. GPU command clearing resets counts even when there are zero candidates; no CPU counter readback in frames. Buffer capacity covers every candidate; defensive overflow counters are diagnostic. Output order is unspecified.

- 110 tests/build/production GPU checks passed. Live compacted IDs exactly [0,2]; sparse 14,373 IDs match every refined visibility flag without duplicates; all-visible 100,000 IDs contain every candidate once; an empty capture clears stale counts. All overflow counters are zero.
- Compaction-only completion median 0.3 ms for both sparse and all-visible 100,000-candidate fixtures; CPU encoding below browser 0.1 ms resolution. No evidence of problematic append contention in these workloads, so prefix scan is deferred. No warm resource creations.
- Raw results: `benchmarks/results/phase-37.json`.

## Phase 38 — validated

CPU prepares shared batch metadata and object/instance mappings; GPU initializes indexed indirect arguments, appends visible opaque/mask instances and activates ordered transparent slots. Color submits drawIndexedIndirect per batch without CPU visibility/count readback. Transparent order is preserved with fixed slots and invisible vertex markers. The graph now uses current camera prepass -> Hi-Z -> occlusion -> compaction -> arguments -> color. Shared deformation remains unchanged.

- 111 tests/build/production GPU checks passed. GPU indirect matches complete direct-rendered images for 10,000 cubes, morph/skin, alpha mask and ordered transparency. Frustum arguments contain three live instances; occlusion arguments contain two. Looking away produces zero-instance arguments; no warm resource creations or unchanged mapping uploads.
- 10,000 cubes end-to-end encoding/completion median: CPU instancing 1.1/3.1 ms, GPU indirect 1.4/3.6 ms. GPU sphere conservatism keeps 5,963 candidates versus CPU AABB 5,655; all image bytes still match. This workload does not justify making GPU indirect the default. CPU instancing remains default.
- GPU indirect requires optional indirect-first-instance support, requested when available; unsupported activation fails explicitly. Actual GPU-visible/triangle/instance counters are -1 in CPU stats rather than fabricated counts; explicit diagnostics read them outside frames.
- Raw results: `benchmarks/results/phase-38.json`.

## Phase 39 — validated

GPU screen-size selection uses authored thresholds and per-entity hysteresis; selected mesh metadata feeds expanded indirect batches. Shared visible records carry selected morph offsets and vertex stride. LOD objects are excluded from the initial occluder prepass to avoid hiding geometry through coarser LOD holes; color writes their actual selected depth.

- 112 tests/build/production GPU checks passed. 12/8/1/0 triangle sequence, hysteresis, different morph vertex counts and transparent LOD order all match CPU images exactly.
- 100,000 candidates: zero CPU/GPU LOD mismatches, CPU LOD 1.9 ms and frustum + GPU LOD completion 1.1 ms (prepared inputs). Warm resource counts unchanged. GPU indirect remains opt-in based on the end-to-end baseline.
- Raw results: `benchmarks/results/phase-39.json`.

## Phase 40 — validated

Opt-in temporal visibility stores GPU flags before LOD refinement and reuses them with the prior Hi-Z only when exact camera/projection, membership, geometry, transforms, material revision and deformation snapshots match. Any motion resets, including small motion; new/re-enabled objects get one conservative visible frame before fresh occlusion. No CPU visibility readback or waits in rendering.

- 113 tests/build/production GPU checks passed. First/new hidden objects stay visible, then fresh culling hides them; stable images match exactly. Camera teleport, rotation, viewport, material and deformation resets pass. No warm resource creation.
- Exact snapshot comparison for 100,000 objects averages 5.0942 ms, so reuse stays opt-in. Small static fixture readback-inclusive medians are 3.3 ms off / 2.8 ms on; this is not a general end-to-end speedup claim.
- Raw results: `benchmarks/results/phase-40.json` and `benchmarks/results/phase-40-cpu.json`.

## Phase 41 — validated

Observable Unloaded/Loading/Decoded/Uploading/Ready/Failed records share concurrent requests and reuse decoded/uploaded assets. Network/container acquisition, CPU conversion and GPU preparation are separate asynchronous stages, yielding between stages and primitive uploads. Instantiation shares numeric mesh/material IDs and uploaded bounds; existing scene acts as loading placeholder. Rendering never awaits assets.

- 115 tests/build/production GPU checks passed, including network/decode/upload failure and retry. A delayed GLB takes 214.3 ms with 12 rendered frames; network 210.1 ms, decode 2.9 ms, upload 0.6 ms. Cached instantiation takes 0.1 ms with identical resource counts.
- Large single-primitive CPU preprocessing still runs synchronously within its upload task; Phase 43 profiling will determine worker use.
- Raw results: `benchmarks/results/phase-41.json`.

## Phase 42 — validated

Streaming leases coalesce cold requests and track reference counts plus last used frame. Renderer LOD/material slots retain leases, keep resident fallbacks during loading, and restore fallbacks before release. Async eviction fences submitted work, then rechecks leases and render/LOD/material references before destroying resources. Texture ownership protects shared deduplicated images. Numeric mesh IDs are never recycled.

- 118 tests/build/production GPU checks passed. Acquisitions during fences, shared references and pending loads resist eviction. Streamed LOD/texture images restore exactly, and buffer/texture resident counts and bytes return to baseline after eviction.
- Small fixture LOD load/eviction 0.2/0.1 ms; texture load/eviction 0.6/0.2 ms. These are maintenance timings, not frame waits. Shared deformation arenas remain renderer-owned; individual streamed morph blocks are retained until renderer disposal, avoiding stale-offset reuse.
- Raw results: `benchmarks/results/phase-42.json`.

## Phase 43 — validated

Profiled 100,000 vertices: glTF parse/conversion 31.1577 ms, mesh CPU packing 4.4140 ms. Payloads at least 1 MiB use a persistent module worker; smaller assets retain the simpler main-thread path. Input JSON resource buffers and detached runtime outputs transfer ownership, deduplicating aliased buffers. Worker failure/disposal rejects pending jobs; retries reload fresh network buffers.

- 120 tests/build/production GPU checks passed. Main/worker attributes match exactly, inputs detach, 11.2 MB moves each direction across four jobs without structured-clone array copies. Rendering advances two frames during cold decode; none during the main-thread decode.
- Browser main decode 21.9 ms, cold worker 38.8 ms, warm worker median 19.1 ms (worker processing 18 ms). Cold startup trades latency for responsiveness. Mesh packing remains on the yielded upload path because its profiled cost fits a frame budget.
- Raw results: `benchmarks/results/phase-43.json` and `benchmarks/results/phase-43-cpu.json`.

## Phase 44 — optional feature validated

User amendment replaces the previous benchmark gate: advanced geometry may be implemented experimentally, disabled by default. `renderer.geometryOptimization.enabled = true` activates compute frustum culling of static mesh clusters followed by indexed indirect color draws; `supported` exposes the optional indirect-first-instance requirement.

Static triangle assets prepare shared consecutive 256-triangle cluster ranges and local AABBs during cold upload. Vertex/index buffers and vertex IDs remain unchanged; instance-major primitive order is preserved. GPU transforms local bounds conservatively under reflection, nonuniform scale and shear. No frame readbacks/waits or resource construction. GPU buffers and the large CPU staging array allocate only on first supported enable, remain warm across toggles and are disposed with the renderer. Unchanged cluster records upload zero bytes; only the 80-byte camera/count header updates.

Small one-cluster meshes, non-triangle geometry, skin/morph geometry, BLEND materials, unsupported adapters, overflowing whole batches and GPU object-indirect submission retain the existing draw path. CPU LOD can select eligible clustered meshes. Camera depth and shadows use full geometry to preserve existing occlusion and deformation correctness. This implements mesh clustering, cluster bounds and compute/indirect cluster culling; geometry streaming already exists in Phase 42. Cluster LOD and additional meshlet packing are future extensions, not claimed implementations.

- 129 unit tests across 40 files, strict TypeScript/production build, full production-preview WebGPU regression and expanded independent benchmark matrix pass with zero GPU/page errors.
- 200,000 triangles form 782 clusters. Mostly outside the camera: 575 clusters reject, leaving 52,992 triangles. Fully visible: all 782 remain. Every enabled/disabled image matches byte-for-byte, with zero false-invisible clusters against an independent eight-corner clip-space reference.
- Checks cover depth prepass, mirrored/sheared instancing, MASK, shadows, actual CPU LOD selection, near plane, culling disabled, viewport resize, transparent fallback, GPU object-indirect fallback and combined morph/skin fallback. Warm resource-creation counts remain unchanged; unsupported devices allocate no feature GPU resources.
- GPU color work decreases in the mostly-outside fixture, but 782 indirect commands replace one draw and total completion varies around 2 ms. Fully visible geometry regresses from roughly 1.8 to 2.2 ms. Default remains off; no universal speedup is claimed.
- CPU-only cluster metadata preparation for 200,000 triangles averages 3.7311 ms; browser full packing/upload setup takes about 30 ms (cold asset work).
- Raw results: `benchmarks/results/phase-44.json`, `phase-44-cpu.json`, and the geometry section of `benchmark-matrix.json`. See `benchmarks/REPORT.md` for final measured timings.

## Final completion audit — validated

Phases 1–44 are validated; Phase 44 is optional and disabled by default under the user’s amended rule. Native compressed textures are validated (122 tests/build/production GPU checks): KTX2 BC/ETC2/ASTC role-correct formats, authored mips, block/dimension/DFD checks and adapter feature gates. BC1's four mip blocks read back exactly and its full image equals the RGBA reference. Tiny fixture cold native/PNG uploads take 0.7/2.7 ms; native chain is 56 bytes versus 340 RGBA bytes. Basis Universal/supercompression remains an explicitly rejected future asset technology, as permitted by the technology stack. Raw result: `benchmarks/results/compressed-textures.json`. Container layout follows the [Khronos KTX specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html).

The required A–G benchmark matrix is complete. Final gates after Phase 44: 129 tests across 40 files, strict TypeScript/production build, real Chrome WebGPU production-preview regression, and the independent GPU workload matrix all pass. No scoped/uncaptured GPU errors or page errors; warm workload resource-creation counts remain unchanged. The source Definition of Done is covered, with optional eight-weight GPU skinning and future Basis/Draco/Meshopt technologies explicitly unsupported rather than silently misrendered.

- A: 10,000 cubes, individual/sorted/instanced/BVH full images agree. Instancing issues one draw versus 10,000.
- B: 100,000 bounds, enumeration/CPU frustum/BVH/GPU frustum/GPU Hi-Z measured. GPU flags match independent references with zero false-invisible results; construction/upload/depth exclusions are explicit.
- C: 1/100/1,000 materials across three submission modes; material and draw counts asserted.
- D: 1/100/500/1,000 independent characters with 64 joints, shared bind/clip assets, independent palettes, changed-range upload counts asserted.
- E: 1,000 characters with 0/1/4/8/16 active morph targets; signed nonzero activity and upload counts asserted.
- F: 1,000 characters combining 64 joints and 16 morph targets, one draw, 4,096,000 joint bytes and 64,000 weight bytes uploaded.
- G: 10,000 hidden objects plus occluder; visible instances drop from 10,001 to one with byte-identical images. Depth/Hi-Z overhead makes total completion slower in this fixture, so occlusion stays opt-in.

Benchmark-driven refinement skips delta-buffer reads for zero-weight morph targets while retaining the branchless loop for dense weights. An initial sparse-only implementation regressed dense workloads and was repaired before advancing; both comparison reports are retained. Shared skeleton/clip assets avoid repeated immutable crowd allocation. Streaming texture changes now update/restore UV and normal metadata, increment material revision, and invalidate temporal/shadow caches. A real GPU regression changes an opaque mask to transparent, reveals the hidden object, and matches the CPU image exactly.

The 1,000-character workload is CPU-animation-bound (~38.6 ms CPU frame, ~21.1 ms animation); meshlets would not address the measured bottleneck. Under the original rule Phase 44 was deferred; the user subsequently authorized its optional implementation. It is now validated and remains disabled by default because whole-frame benefits depend on workload.

Final evidence: `benchmarks/results/final-regression.json`, `benchmark-matrix.json`, `benchmark-suite.json`, `final-cpu.json`; methodology and conclusions: `benchmarks/REPORT.md`. No 60 FPS guarantee is claimed for the character stress workload.
