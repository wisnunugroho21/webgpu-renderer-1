# Local shadows and authored PBR validation

Implemented shared-array point/spot shadows, per-light projection/bias controls, glTF clearcoat/specular/IOR/emissive-strength/unlit, and per-role texture transforms. Local shadows reuse existing depth storage and caster/deformation pipelines; authored maps append to the existing material group. Features and practical limits are described in [AUTHORED_RENDERING.md](../AUTHORED_RENDERING.md).

## Validation

The complete `pnpm validate` gate passes 268 tests across 68 files, lint/formatting, production build and all GPU scenarios, including the new `validate:authored` gate. CPU/GPU checks cover six point-face projection conventions, spot cones, transactional invalid-input/layer-capacity rejection, visible local shadowing, per-face caster culling, cache reuse and warm resource stability. Original skin/morph, alpha mask, directional cascades, HDR, custom shader, particle, codec, streaming and recovery scenarios remain passing.

The authored fixture serializes real glTF extensions and maps. Removing each of five extension maps changes its rendered image. Multiplying factors by the reference R/G/A and linearized sRGB map values reproduces the texture result with a maximum one-byte channel error (a handful of differing channels in the measured fixture). This tolerance covers hardware sRGB conversion and reference arithmetic quantization. UV transforms visibly change the image; camera depth enabled/disabled images agree exactly for original and transformed masks. All four submission modes agree exactly. Streamed layout restoration and device recovery agree exactly; recovery also retains the authored material bytes and HDR environment configuration. Clearcoat changes HDR environment illumination and restoring its weight restores the image.

The function comment audit finds no missing comments among 2,545 functions in 356 source/test/script files. Saved assertions are part of the production validation scripts; diagnostic readbacks and completion waits are outside ordinary rendering.

## Performance and resources

Cold CPU benchmark means:

| Workload                                        |  Mean ms |
| ----------------------------------------------- | -------: |
| Fit six point projections                       | 0.001029 |
| Fit one spot projection                         | 0.000180 |
| Compare 10,000 unchanged caster records         |  0.76019 |
| Cull 10,000 caster bounds                       |  0.30577 |
| Fit directional projection to 10,000 bounds     |  0.04692 |
| Publish 1,000 authored material records         |  1.91151 |
| Snapshot/restore 1,000 complete texture layouts |  1.97970 |

Local projections do not traverse caster bounds; required rendering still culls the caster pool independently per face. In the small 640×480 fixture, uncached spot/point work measures roughly 0.1/0.1–0.2 ms CPU encoding and 0.8/1.2–1.4 ms GPU completion respectively. These are diagnostic medians after warm-up on Chrome 153 on the development machine, with 0.1 ms browser timing granularity; they are not portable budgets. Unchanged cached frames record one/six cache hits and zero required depth passes. Warm encoding creates no tracked buffers, textures, shader modules, pipelines or samplers.

The shared shadow array remains 16×1024² depth32float (64 MiB). Points require six layers, spots one and directional lights their configured cascades; invalid configurations exceeding sixteen layers fail explicitly. Nine comparison taps stay within the selected face, so point-face seams remain a quality limit. No new local-shadow resources or per-light GPU groups are allocated.

Material records grow from 80 to 448 bytes. At capacity 2048, shared GPU storage grows by 753,664 bytes (736 KiB), from 160 to 896 KiB. Dirty upload bytes increase by the same per-row factor; unchanged frames still upload zero. The group has ten texture/sampler pairs; the five appended neutral bindings produce five additional sampler cache hits during setup, without additional sampler creation. With IBL and shadows the shader uses fourteen sampled textures and twelve samplers. Optional authored maps skip samples when absent, and default materials retain original lighting arithmetic. Only one base BRDF is evaluated per light, with clearcoat layered when enabled.

The long-animation production matrix passes its reference/work/resource assertions. Comparison against `memory-streaming-matrix.json` finds only 50 larger `bufferBytes` values and 50 setup `cacheHits` values among changed non-timing fields; each memory delta is 753,664 bytes and hit deltas are multiples of five (one added cache lookup per appended sampler per prepared group). Draw counts, visibility/deformation work, uploads on unchanged frames, image comparisons and GPU resource creation counts remain unchanged. Timing samples remain machine/workload measurements; this feature addition makes no animation speedup claim.

## Evidence

- `benchmarks/results/local-shadows-gpu.json`: local shadow validation/benchmark before advancing to PBR.
- `benchmarks/results/authored-rendering-cpu.json`: cold projection/material publication workloads.
- `benchmarks/results/authored-rendering-gpu.json`: authored images, channel references, streaming, recovery, resources and local timings.
- `benchmarks/results/authored-rendering-matrix.json`: production long-animation matrix.
- `benchmarks/results/authored-rendering-comparison.json`: baseline comparison.
- Local ignored logs: `artifacts/authored-full-validation.log`, `authored-final-build.log`, `authored-final-gpu.log`, `authored-final-matrix.log`, `authored-comments.json`.
