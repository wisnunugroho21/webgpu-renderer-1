# Unified transparency

Implemented shared back-to-front alpha ordering for scene meshes, analytic billboards and ribbon segments. Compatible adjacent ranges remain batched; mesh batches split only where effects must appear between instances. One loaded-color/read-only-depth pass composites all alpha layers and then both additive effect types. Existing authoring APIs, GPU-selected visibility/LOD, shared deformation/custom materials and standalone particle encoding remain available. See [PARTICLES.md](../PARTICLES.md) for usage and limitations.

## Validation

The full `pnpm validate` gate passes **282 tests in 70 files**, lint, formatting, strict production build and every GPU scenario, including the new `validate:transparency` gate. Six CPU tests cover interleaving inside mesh batches, deterministic ties, independent reference sorting across 50 varying fixtures, indirect LOD source ranks, capacity/reset/storage reuse and intact 10,000-instance batching.

The production GPU gate checks 24 analytic mixed-layer cases across individual/instanced/GPU-indirect submission, prepass on/off, direct/HDR presentation and reversed camera depth. Forward layers produce stored RGB **[207, 71, 137]**; camera reversal produces **[152, 188, 99]**, matching independent linear source-over references within three stored byte values. Additional cases verify multiple GPU LOD candidates, custom shader family restoration, environment bindings, FXAA-only presentation, additive billboards/ribbons after every alpha layer, disabled effects with surviving mesh transparency, opaque foreground occlusion and exact image recovery. Existing particle gates retain atlas/flipbook/curve, analytic motion, perspective/orthographic soft depth, resize and recovery checks.

A fully alternating fixture contains 128 meshes, 128 billboards and 127 ribbon segments: **383 alpha runs / 383 total draws**, including 255 effect draws. Warm frames create zero GPU resources and upload **144 bytes**, with no persistent billboard/ribbon record uploads. Disposal leaves zero tracked buffers/textures. GPU validation and browser exceptions remain empty. The source comment audit reports no missing function explanations among 2,656 functions in 364 files.

The production long-animation matrix passes its assertions and matches **2,907 existing non-timing values** from `render-graph-matrix.json`, with zero changed values. Existing work/resource/upload/visibility counters and reference images remain unchanged in those scenarios.

## Measurements

| CPU schedule workload                             |  Mean ms |
| ------------------------------------------------- | -------: |
| 10,000 alpha mesh instances, one batch            | 0.000056 |
| 10,000 billboards, one stream                     | 0.000038 |
| 10,000 entries per stream, three separated blocks | 0.000095 |
| 10,000 entries per stream, fully alternating      | 0.418180 |

These are development-machine microbenchmark means for already sorted inputs. Whole-range fast paths make the first three cases effectively constant work; these very small values are microbenchmark throughput estimates rather than independently measurable browser frame costs. Fully alternating merging remains linear and allocation-free. Sorting the individual streams and GPU submission are outside these CPU schedule timings.

The warmed 383-layer production fixture measures roughly **0.2 ms CPU encoding** on this machine. The small four-alpha-layer fixture is below the browser's useful timing resolution in this run. Browser timing is coarse and hardware-dependent; these results do not establish universal frame-time guarantees or a speedup over the previous incorrect cross-stream ordering.

## Costs and limits

Alpha blending is order-dependent. Correct interleaving can increase mesh/effect draw counts compared with drawing each type in a separate group. Contiguous ranges still share one draw; additive billboards and ribbons need at most one draw per type after alpha. The old universal four-effect-draw ceiling no longer applies. Monitor `drawCalls`, `particleDrawCalls` and `renderer.transparency.count`; the last counter excludes additive draws.

Fixed typed schedule capacity reserves eight mesh LOD candidates per render object plus configured billboard/ribbon segment capacities, using 13 bytes per possible run. `BatchBuilder.queueFirst` adds four CPU bytes per possible batch to distinguish source queue ranks from indirect visible-record offsets. No GPU buffers/textures/pipelines are added for ordering. There are no production visibility readbacks, completion waits or steady-frame GPU object construction. Opaque-only scenes skip the combined transparency pass. Opt-in `GPUPass.transparency` timestamps measure the combined pass separately from opaque color.

Mesh sphere centers, analytic particle centers and segment midpoints are sorting proxies. Equal depths use deterministic mesh/billboard/ribbon precedence and retain stable stream rank. Intersecting triangles, large overlapping billboards and self-overlapping ribbons may still need content changes or a future per-pixel transparency method. This implementation does not claim order-independent transparency, refraction/transmission or per-triangle sorting.

## Evidence

- `benchmarks/results/transparency-cpu.json`
- `benchmarks/results/transparency-gpu.json`
- `benchmarks/results/transparency-matrix.json`
- `benchmarks/results/transparency-comparison.json`
- Ignored local logs: `artifacts/transparency-validation.log`, `transparency-build.log`, `transparency-gpu.log`, `transparency-cpu.log`, `transparency-matrix.log`, `transparency-comments.json`.
