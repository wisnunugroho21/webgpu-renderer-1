# Animation optimization, round 2 — 2026-10-04

This round starts from the quaternion optimizations in `ANIMATION_REPORT.md`. Fresh local CPU and browser benchmarks were captured before editing.

## Changes

- Transform updates address matrices by offsets in existing packed storage. `Mat4.multiply` and `fromTRS` accept optional offsets while existing callers retain zero-offset behavior. Root transforms write directly into world storage. Dirty descendants reuse the local scratch matrix, eliminating two temporary typed-array views per child update.
- Skeleton pose comparison stops after the first mismatch. A changed mesh already requires palette recomputation, so redundant pose comparisons are skipped in that case. Changed entries still copy all 16 components and use the same two matrix products; unchanged poses still compare every component.
- Animation writes use `TransformStore.setNormalizedRotation` after normalized sampling or pose blending. This avoids another scratch copy and normalization while preserving dirty propagation. Its contract requires normalized input; gameplay's `setRotation` continues normalizing arbitrary inputs.
- Quaternion SLERP reads packed normalized keys directly through optional offsets. Both endpoints are cached as scalars before writing, eliminating eight scratch component copies per rotation sample and supporting overlapping input/output. Interpolation and final sampler normalization are retained.

No animation frames are skipped, times quantized, character poses shared, GPU buffers added, or waits/readbacks introduced into normal frames. The normalized setter can change the last rounding bit relative to an extra normalization; numerical and GPU image checks pass.

## Measurements

Chrome production-preview crowd benchmark, 1,000 independently controlled characters × 64 joints:

| CPU stage             | Before (ms) | After (ms) |
| --------------------- | ----------: | ---------: |
| Animation             |        11.1 |       10.8 |
| Transforms            |         6.3 |        4.1 |
| Skeleton palettes     |         5.6 |        5.1 |
| Complete CPU frame    |        29.0 |       25.9 |
| Diagnostic completion |        33.0 |       29.6 |

Transform time decreases about 35%, and CPU frame time about 11%. The larger improvement comes from transform preparation; the small animation-stage difference alone is insufficient for a broad speedup claim.

For the combined 64-joint/16-target crowd, the CPU frame decreases 31.2 → 27.4 ms. The warmed animation-only profiler measures 5.5 ms, excluding transform/skeleton/GPU work; it is not a complete-frame measurement.

Representative Vitest CPU means:

| Workload                        | Before (ms) | After (ms) |
| ------------------------------- | ----------: | ---------: |
| 1,000 independent TRS animators |      0.2208 |     0.1948 |
| 100 dirty transforms            |      0.0079 |     0.0053 |
| 10,000 dirty transforms         |      0.7739 |     0.5363 |
| 10,000 general matrix products  |      0.2314 |     0.2410 |
| 6,400 unchanged skeleton poses  |      0.1092 |     0.1127 |
| 6,400 changed skeleton poses    |      0.6010 |     0.6075 |

The general matrix microbenchmark costs about 4% more with offset support. The skeleton microbenchmarks show no improvement. Those results are retained rather than presented as universal gains: avoiding views produces a substantial complete-transform improvement, and the browser crowd's palette stage improves modestly. Timing depends on the runtime, warmup and workload; the matrix uses short warm samples and finite browser timer resolution.

## Validation

134 tests across 40 files, strict TypeScript/production build, full production-preview GPU regression, independent GPU benchmark matrix, focused CPU benchmarks and formatting checks pass. New tests exercise matrix offsets, exact-range aliases, untouched neighboring storage, packed quaternion aliasing, constant-rotation dirty state and descendant propagation. Existing tests cover hierarchy ordering/reparenting, inverse mesh palettes, singular transforms, removed joints, crossfades, reverse playback, morph/skin bounds, depth and shadows.

Before/after matrix work counters, upload bytes and warm resource statistics match exactly. GPU validation reports zero errors; image/reference correctness assertions pass. Static/animated deformation and visibility are preserved.

Raw evidence: `results/animation-round2.json`, `animation-round2-before-cpu.json`, `animation-round2-after-cpu.json`, `animation-round2-before-matrix.json`, `animation-round2-after-matrix.json`, and `animation-round2-regression.json`.

Reproduce with the existing test/build/GPU commands and:

```sh
pnpm run profile:animation round2
pnpm run benchmark -- tests/animation.bench.ts tests/blending.bench.ts tests/ecs.bench.ts tests/skinning.bench.ts tests/math.bench.ts --outputJson artifacts/animation-cpu.json
```

The complete 1,000-character frame still exceeds a 16.7 ms CPU budget. Remaining work is concentrated in animation pose writes, packed matrix arithmetic and palette preparation. Further changes need independently phased/long-clip workloads alongside the current crowd, so optimizations do not rely on its repeated phases. No 60 FPS guarantee is claimed.
