# Final benchmark evidence

Validated on 2026-10-03 using Chrome 153.0.8010.53, Apple Metal WebGPU, production preview, 1280×960 physical pixels. All 129 unit tests, strict TypeScript/build, production GPU regressions and workload assertions pass. These are synthetic fixtures and machine-specific measurements.

| Suite | Workload | Measured result |
| --- | --- | --- |
| A | 10,000 indexed cubes | Individual/sorted/instanced CPU encoding medians 1.80/1.70/1.40 ms; 10,000/10,000/1 draws. Full images identical. Fully visible BVH: 2.50 ms. |
| B | 100,000 bounds | CPU sphere query 3.00 ms; BVH AABB query 0.60 ms plus 161.40 ms construction. Prepared GPU frustum 0.40 ms, frustum + Hi-Z 0.50 ms. Zero reference mismatches. |
| C | 1,000 objects, 1/100/1,000 materials | Sorted material runs equal unique material count; instanced draw counts 1/100/1,000. All three submission modes measured. |
| D | 1/100/500/1,000 independent 64-joint characters | CPU frame medians 0.20/3.90/19.40/38.60 ms. At 1,000: animation 21.10 ms, GPU color 1.84 ms, one draw, 4,096,000 joint-upload bytes. |
| E | 1,000 characters, 0/1/4/8/16 active morph targets | GPU color medians 2.42/2.49/2.69/2.95/3.08 ms. One draw; changed weight bytes equal active targets × 1,000 × 4. |
| F | 1,000 characters, 64 joints + 16 targets | CPU frame 39.10 ms, GPU color 3.15 ms; one draw, 4,096,000 joint bytes + 64,000 morph bytes. |
| G | Occluder plus 10,000 hidden cubes | GPU-visible instances 10,001 → 1; full images identical. Total completion 7.30 → 8.20 ms; current-depth preparation offsets saved color work. |

GPU color timestamps include vertex and fragment work; they do not isolate vertex cost. Adapter timestamps are quantized to 0.065536 ms. Matrix medians use warmed frames and three timestamp captures; CPU clocks have finite browser resolution. Completion measurements include explicit diagnostic GPU waits, and differ from CPU encoding and pass timestamps. Ordinary rendering never maps or waits for GPU completion. RAF FPS reports submission cadence rather than presentation or completion throughput.

B uses identical spheres and camera across methods. CPU/GPU sphere results agree at 99,700 visible; conservative BVH AABBs retain 99,900. Prepared Hi-Z leaves 14,373 with zero independent-reference mismatches. GPU compute timings exclude input preparation/upload and depth/Hi-Z generation. Enumeration omits draw work. These figures are not an end-to-end speedup comparison.

Immutable skeleton bind data and animation clips are shared; palettes/controllers remain independent. Sparse morph weights skip delta-buffer reads. Compared with the preserved pre-optimization run, zero-active color time decreased from 3.15 to 2.36 ms; dense 16-active time remained about 3.1 ms. A first sparse-only loop regressed dense weights and was replaced with a dense branchless path before the final validation. Variation between runs limits small timing claims.

CPU instancing stays default. BVH, prepass, GPU indirect, occlusion and exact temporal reuse remain optional because each has workloads where overhead outweighs savings. The character stress fixture exceeds a 60 FPS CPU budget; animation is the measured bottleneck. The original Phase 44 gate did not justify meshlets. The user subsequently amended the rule to authorize an optional experimental implementation; cluster culling is now validated and disabled by default. No failed task was skipped.

Evidence:

- [Complete A–G matrix](results/benchmark-suite.json), [independent matrix](results/benchmark-matrix.json), [final GPU regression](results/final-regression.json), [CPU benchmarks](results/final-cpu.json).
- [Morph baseline](results/benchmark-matrix-before-morph-skip.json), [rejected sparse-only variant](results/benchmark-matrix-morph-sparse-only.json).
- Individual phase evidence is retained in `results/phase-*.json`; [PROGRESS.md](../PROGRESS.md) records the sequential validation gates and feature limits.

Reproduce with `npm test`, `npm run build`, `RENDERER_PREVIEW=1 npm run validate:gpu`, `npm run benchmark:gpu`, and `npm run benchmark -- --outputJson artifacts/benchmarks.json`. Google Chrome and an available WebGPU adapter are required. GPU scripts own isolated ports 5187/5188 and stop their own server processes.

## Optional Phase 44

The user amended the implementation gate on 2026-10-03. The optional path implements static mesh clustering, conservative GPU cluster frustum culling and indexed indirect color draws. It preserves triangle/instance order and uses the conventional path for unsupported geometry/modes or capacity overflow. Depth and shadow geometry remain unchanged. Feature GPU resources and staging are created on first supported enable; unchanged cluster metadata needs no upload, and warmed frames update only an 80-byte header.

The 200,000-triangle fixture has 782 consecutive 256-triangle clusters. With most geometry outside the camera, GPU diagnostics retain 207 clusters / 52,992 triangles and reject 575; fully visible geometry retains all 782. Enabled/disabled full images agree exactly, and the independent clip-space reference finds zero falsely hidden clusters. Tests also exercise mirrored/sheared instancing, MASK, depth prepass, shadows, CPU LOD, near plane, disabled culling, resize, transparency and animated/object-indirect fallback.

| Workload | Feature | CPU encoding (ms) | GPU color (ms) | Completion (ms) |
| --- | --- | --- | --- | --- |
| mostly-outside | Off | 0.00 | 1.31 | 1.90 |
| mostly-outside | On | 0.10 | 1.05 | 2.00 |
| fully-visible | Off | 0.00 | 1.11 | 1.80 |
| fully-visible | On | 0.10 | 1.31 | 2.20 |

CPU-only metadata construction averages 3.7311 ms for 200,000 triangles; browser full mesh preparation takes about 30 ms including packing and upload submission. This is cold asset work. Feature CPU encoding and total completion include preparing/submitting all 782 indirect commands, including zero-instance draws. GPU color timings include fragment work; timestamp zero means below adapter resolution, not zero compute cost. Whole-frame speedups are workload-dependent and small differences vary between runs. The fully visible case regresses, which supports keeping the feature off by default.

Raw evidence: [Phase 44](results/phase-44.json), [CPU preparation](results/phase-44-cpu.json), and the `geometry` section of [the expanded matrix](results/benchmark-matrix.json). Run `npm run benchmark:gpu` for all correctness and GPU workload checks, or `npm run benchmark -- tests/geometry.bench.ts --outputJson artifacts/phase-44-cpu.json` for isolated CPU preparation.
