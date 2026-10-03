# WebGPU renderer

TypeScript/Vite renderer following [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). The initial repository was empty. See [PROGRESS.md](PROGRESS.md) for phase-by-phase validation, benchmark evidence, limitations and optional feature limits.

```sh
npm ci
npm run dev
```

Open the displayed localhost URL in a WebGPU-capable browser. The initial scene is an indexed cube. Resize handling uses physical pixel dimensions and device limits; device loss stops rendering and reports the loss.

## Code organization

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map, frame sequence, shared GPU layouts, resource ownership, optional feature constraints, and maintenance workflow. Renderer initialization, frame preparation, asset upload, shader code, and GPU validation have separate responsibilities with comments around their invariants.

```sh
npm run format
npm run format:check
```

## Validation

```sh
npm test
npm run build
npm run validate:gpu
RENDERER_PREVIEW=1 npm run validate:gpu
npm run benchmark -- --outputJson artifacts/benchmarks.json
npm run benchmark:gpu
```

The GPU harness requires installed Google Chrome and a usable WebGPU adapter. It starts its own server on isolated port 5187, checks pixel output, camera movement without resource creation, resize, device loss, material modes, offscreen rejection, GLB loading, PBR texture/factor/UV/alpha checks, odd-sized linear/sRGB mipmaps, concurrent texture deduplication, decode failures, and full-image equivalence for 10,000 individual/sorted/instanced cubes. It also compares linear and static BVH rendering. GPU completion waits and mapped readbacks are diagnostic operations; ordinary frames never wait or read back. The independent benchmark matrix uses isolated port 5188 and covers material counts, 64-joint crowds, morph counts, combined deformation and occlusion.

Production preview validation requires `npm run build` first. CPU benchmark results are machine-specific and exclude GPU pass timing. Construction cost is excluded from BVH query benchmarks. BVH remains opt-in because it was slower in the fully visible scene despite improving the mostly rejected static benchmark.

Historical and final evidence is saved in `benchmarks/results/`; fresh local results and screenshots go to `artifacts/`. See [benchmarks/REPORT.md](benchmarks/REPORT.md) for the complete A–G matrix and timing limits. Crowd fixtures can be regenerated with `node scripts/create-crowd-fixtures.mjs`.

Quaternion animation now prepares shared normalized LINEAR keyframes once and avoids unnecessary interpolation/normalization work. The 1,000-character crowd's measured animation stage decreased from 21.4 to 11.1 ms. See [animation optimization evidence](benchmarks/ANIMATION_REPORT.md). After building, `npm run profile:animation -- current` captures an animation-only timing summary and Chrome CPU profile on isolated port 5190.

The [second animation optimization round](benchmarks/ANIMATION_ROUND2_REPORT.md) removes temporary matrix views and redundant pose work. Its fresh 1,000-character CPU frame benchmark decreases from 29.0 to 25.9 ms, primarily through faster transform updates.

## Runtime API

In the browser console after initialization:

```js
await window.rendererApp.loadAsset("/regression/triangle.glb");
window.rendererApp.renderer.camera.setPosition(0, 0, 5);
window.rendererApp.renderer.visibilityMode = "bvh";
```

The loader uses [glTF Transform core](https://gltf-transform.dev/) for container/accessor decoding and converts the decoded document to engine-owned data. Render passes read `RenderWorld`; shared GPU assets are addressed by numeric mesh/material IDs. Loading adds the selected scene to the world. The synthetic GLB fixture can be regenerated with `node scripts/create-regression-assets.mjs`.

Entity and material capacities are explicit. Entity IDs are monotonic, preventing stale-ID aliasing; exhausted capacity fails rather than allocating GPU resources in the frame loop. BVH-static objects are marked with `RenderFlags.STATIC`; changes invalidate the snapshot hierarchy. Gameplay changes should use transform setters so dirty propagation occurs.

Phases 1–44 and the Definition of Done are validated. Phase 44 advanced geometry is an optional feature, disabled by default under the user’s amended rule. CPU instancing remains the default; GPU visibility, indirect drawing, LOD and temporal reuse are available as measured optional paths.

PBR shading uses shared material records and five glTF texture maps, with sRGB color attachments and linear blending. Textures decode asynchronously; full GPU mip chains, shared samplers and content-based deduplication are prepared during loading. Linear data and sRGB color uses receive separate cached textures.

Animated GLBs register independent controllers in `rendererApp.animations.animators`. Call `play(clipIndex)`, `pause()`, `stop()`, or set `loop`, `speed` and `currentTime`. Morph and four-weight skin deformation run in shared WGSL helpers; frames upload changed palettes/weights and never rewrite vertex buffers. Optional eight-weight skinning currently fails explicitly on GPU upload. Bounds use conservative morph extrema and joint boxes before linear/BVH culling.

Lights use ECS `world.lights.set(entity, properties)` with directional/point/spot types. Directional lights opt into shadows with `castShadow: true`. Configure `renderer.shadows.cascades` (1–4), `shadowDistance` (>0.1–100), `enabled`, or `cacheEnabled`. The shared array supports four shadow lights and rejects overflow. Clustered lighting defaults to automatic selection for many bounded lights; `renderer.clusters.mode` accepts `auto`, `off`, or `on`, with safe overflow fallback.

`app.profiler` exposes fixed CPU stage history and frame totals. `renderer.gpuProfiler.supported` reports timestamp availability. Set `enabled=true` for at most three captured frames, then `enabled=false` and explicitly call `await readSamples()` for pass times. Full capture slots drop further samples until readback; this diagnostic API keeps all readback outside ordinary frames.

`renderer.depthPrepass.enabled` is optional; it helps overdraw/expensive shading but can regress simple scenes. `renderer.hiz.debugEnabled=true` with `debugMip` displays max-depth mips. Hi-Z/occlusion enable their depth prerequisites. `renderer.submissionMode='gpu-indirect'` enables GPU frustum, compaction and indirect arguments when `gpuDraws.supported` is true; set `gpuOcclusion.enabled=true` for current-depth occlusion. CPU instancing remains faster in the initial 10,000-cube benchmark and remains default. GPU-driven visible/instance/triangle counts are -1 in CPU stats; explicit GPU diagnostics provide actual values.

GPU LOD consumes authored compatible mesh groups registered with `renderer.lodGroups`, referenced by `world.meshes.setLOD(entity, group)`. Thresholds use physical projected size and hysteresis. Opt-in `renderer.temporal.enabled` reuses visibility only for exact stable snapshots; camera, viewport, geometry, material and deformation changes invalidate it. Newly added objects receive a conservative visible frame. LOD geometry is excluded from the initial occluder prepass to preserve conservative visibility.

`app.assetLoader` exposes observable loading records through Unloaded/Loading/Decoded/Uploading/Ready/Failed states. Concurrent loads share decode/upload work; repeated instantiation shares numeric GPU assets. Payloads of at least 1 MiB decode in a persistent worker with transferable buffers; small payloads use the main thread. Upload tasks yield between primitives. A single large primitive still packs on the main thread.

`renderer.streaming.bindLOD(group, level, key, loadPrimitive)` and `bindMaterial(materialID, key, loadAsset)` retain resident fallbacks while loading. Streamed texture assets contain one material and replace its texture slots while preserving scalar factors. Call `releaseLOD`/`releaseMaterial` to restore fallbacks, then asynchronously `await renderer.streaming.evictUnused(minimumAge)` outside the frame loop. Eviction waits for submitted work and rechecks references; shared morph arena blocks remain allocated until renderer disposal. Texture slot changes restore UV/normal metadata and invalidate shadow/temporal caches.

Native KTX2 compressed textures support adapter-gated BC, ETC2/EAC and ASTC formats, role-correct linear/sRGB sampling and authored mip chains. Unsupported formats, malformed blocks, cubemaps/arrays, Basis Universal and supercompression fail explicitly. Ordinary decoded images still receive generated GPU mipmaps.

`renderer.stats` exposes draw/state/visibility, uploads, deformation activity, FPS and frame durations. FPS measures RAF submission cadence; GPU timing requires the explicit profiler. `activeMorphTargets` counts nonzero signed weights, while `morphTargets` counts declared attached targets. The 1,000-character benchmark is CPU-animation-bound and exceeds a 60 FPS frame budget on the tested machine.

Enable optional Phase 44 cluster culling after initialization:

```js
const geometry = window.rendererApp.renderer.geometryOptimization;
if (geometry.supported) geometry.enabled = true;
// Restore conventional mesh draws:
geometry.enabled = false;
```

Uploaded static triangle meshes are divided into shared, consecutive 256-triangle clusters. Compute culls conservative transformed cluster bounds and writes indexed indirect color draws. Small meshes, animated meshes, transparency, unsupported adapters, capacity overflow and `gpu-indirect` object submission use the existing draw path. CPU LOD is supported; depth and shadows retain full geometry. This version provides cluster bounds/culling rather than a mesh-shader API or GPU cluster LOD.

GPU resources and large staging storage allocate once on first supported enable and remain resident until renderer disposal. The fixed limit is 65,536 cluster-instance records per frame; overflowing batches fall back intact. `geometryClusterCandidates` counts cluster-instance records; `geometryClusterDraws` counts submitted indirect commands, including zero-instance culled commands. Actual GPU triangle/instance counts remain `-1` in runtime statistics; benchmark diagnostics read them explicitly. GPU profiler pass 10 measures cluster culling. The expanded `npm run benchmark:gpu` validates enabled/disabled full images and measures both mostly rejected and fully visible 200,000-triangle workloads.
