# Final benchmark evidence

Validated on 2026-10-03 using Chrome 153.0.8010.53, Apple Metal WebGPU, production preview, 1280×960 physical pixels. All 124 unit tests, strict TypeScript/build, production GPU regressions and workload assertions pass. These are synthetic fixtures and machine-specific measurements.

| Suite | Workload | Measured result |
| --- | --- | --- |
| A | 10,000 indexed cubes | Individual/sorted/instanced CPU encoding medians 1.7/1.8/1.4 ms; 10,000/10,000/1 draws. Full images identical. Fully visible BVH: 2.6 ms. |
| B | 100,000 bounds | CPU sphere query 3.0 ms; BVH AABB query 0.3 ms plus 170.3 ms construction. Prepared GPU frustum 0.4 ms, frustum + Hi-Z 0.5 ms. Zero reference mismatches. |
| C | 1,000 objects, 1/100/1,000 materials | Sorted material runs equal unique material count; instanced draw counts 1/100/1,000. All three submission modes measured. |
| D | 1/100/500/1,000 independent 64-joint characters | CPU frame medians 0.2/4.2/20.5/38.6 ms. At 1,000: animation 21.1 ms, GPU color 1.90 ms, one draw, 4,096,000 joint-upload bytes. |
| E | 1,000 characters, 0/1/4/8/16 active morph targets | GPU color medians 2.36/2.49/2.69/2.95/3.08 ms. One draw; changed weight bytes equal active targets × 1,000 × 4. |
| F | 1,000 characters, 64 joints + 16 targets | CPU frame 38.4 ms, GPU color 3.21 ms; one draw, 4,096,000 joint bytes + 64,000 morph bytes. |
| G | Occluder plus 10,000 hidden cubes | GPU-visible instances 10,001 → 1; full images identical. Total completion 7.3 → 7.8 ms because current-depth preparation offsets saved color work. |

GPU color timestamps include vertex and fragment work; they do not isolate vertex cost. Adapter timestamps are quantized to 0.065536 ms. Matrix medians use warmed frames and three timestamp captures; CPU clocks have finite browser resolution. Completion measurements include explicit diagnostic GPU waits, and differ from CPU encoding and pass timestamps. Ordinary rendering never maps or waits for GPU completion. RAF FPS reports submission cadence rather than presentation or completion throughput.

B uses identical spheres and camera across methods. CPU/GPU sphere results agree at 99,700 visible; conservative BVH AABBs retain 99,900. Prepared Hi-Z leaves 14,373 with zero independent-reference mismatches. GPU compute timings exclude input preparation/upload and depth/Hi-Z generation. Enumeration omits draw work. These figures are not an end-to-end speedup comparison.

Immutable skeleton bind data and animation clips are shared; palettes/controllers remain independent. Sparse morph weights skip delta-buffer reads. Compared with the preserved pre-optimization run, zero-active color time decreased from 3.15 to 2.36 ms; dense 16-active time remained about 3.1 ms. A first sparse-only loop regressed dense weights and was replaced with a dense branchless path before the final validation. Variation between runs limits small timing claims.

CPU instancing stays default. BVH, prepass, GPU indirect, occlusion and exact temporal reuse remain optional because each has workloads where overhead outweighs savings. The character stress fixture exceeds a 60 FPS CPU budget; animation is the measured bottleneck. The plan's Phase 44 prerequisite does not justify meshlets, so advanced geometry is deferred. No failed task was skipped.

Evidence:

- [Complete A–G matrix](results/benchmark-suite.json), [independent matrix](results/benchmark-matrix.json), [final GPU regression](results/final-regression.json), [CPU benchmarks](results/final-cpu.json).
- [Morph baseline](results/benchmark-matrix-before-morph-skip.json), [rejected sparse-only variant](results/benchmark-matrix-morph-sparse-only.json).
- Individual phase evidence is retained in `results/phase-*.json`; [PROGRESS.md](../PROGRESS.md) records the sequential validation gates and feature limits.

Reproduce with `npm test`, `npm run build`, `RENDERER_PREVIEW=1 npm run validate:gpu`, `npm run benchmark:gpu`, and `npm run benchmark -- --outputJson artifacts/benchmarks.json`. Google Chrome and an available WebGPU adapter are required. GPU scripts own isolated ports 5187/5188 and stop their own server processes.
