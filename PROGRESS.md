# Implementation progress

Source of truth: `IMPLEMENTATION_PLAN.md`, copied unchanged from the supplied document.

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

## Remaining phases

Phase 14 (PBR Rendering) is the earliest incomplete phase, with dependencies satisfied. Phases 14–44 and the overall definition of done remain incomplete. No later phase has been skipped or marked validated.
