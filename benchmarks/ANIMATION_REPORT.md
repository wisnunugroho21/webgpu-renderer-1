# Animation optimization — 2026-10-04

Profiling found quaternion sampling and ECS pose writes dominate the CPU animation stage. The previous rotation path normalized two immutable keyframes per sample, normalized interpolation results, and normalized transform assignments. Near-parallel SLERP also calculated angles it never used.

Three changes retain component-space animation and exact playback times:

1. LINEAR rotation samplers normalize immutable keyframes once during construction. These f32 keys belong to shared clips, so independent character controllers reuse them. Endpoint, STEP and cubic handling retain their existing paths. Input/output clip arrays must remain immutable after construction.
2. Nearly parallel quaternion SLERP enters its normalized linear branch before calculating angles. Other rotations retain shortest-path spherical interpolation.
3. Quaternion normalization uses square-root length for ordinary components. Extreme inputs use scaled `Math.hypot` when squaring would overflow or enter the double subnormal range. An initial implementation missed positive subnormal squared lengths; the added extreme-value test failed, and the guard was repaired before validation continued.

No animation frames are skipped, times quantized, character poses shared, or animation moved into rendering. Existing dirty propagation, reverse playback, seeking, crossfade, signed morph weights, GPU skin/morph deformation and conservative bounds remain in place. Normalization can differ in final floating-point rounding from the previous hypot implementation; numerical and image regressions pass.

## Measured results

Sequential local Chrome production-preview measurements, same fixtures and dependencies:

| Workload                                       | Animation before / after (ms) | CPU frame before / after (ms) |
| ---------------------------------------------- | ----------------------------: | ----------------------------: |
| 100 characters × 64 joints                     |                     1.9 / 0.8 |                     3.7 / 2.8 |
| 500 characters × 64 joints                     |                    10.7 / 5.9 |                   19.3 / 14.9 |
| 1,000 characters × 64 joints                   |                   21.4 / 11.1 |                   38.9 / 28.7 |
| 1,000 characters, 64 joints + 16 morph targets |                   21.1 / 11.7 |                   39.1 / 31.2 |

The 1,000-character animation stage uses about 48% less CPU time; the CPU frame uses about 26% less. Matrix work counters, upload bytes and warm GPU resource statistics match the baseline exactly. Completion medians for the skin crowd are 42.5 / 32.4 ms; completion includes diagnostic GPU waits and is distinct from CPU frame time.

The separate animation-only profiler measures 60 updates and reports the last 50; dirty flags are consumed between updates outside the timed interval. Its warmed median decreases from 16.3 to 5.9 ms. This excludes transform matrices, skeleton palettes, bounds, extraction and GPU work, so it must not be substituted for complete-frame timings. Chrome sampling capture runs separately after the timed measurements to avoid profiler overhead in the median.

Vitest CPU mean timings:

| Workload                          | Before (ms) | After (ms) |
| --------------------------------- | ----------: | ---------: |
| 100 independent TRS animators     |      0.0415 |     0.0219 |
| 1,000 independent TRS animators   |      0.3951 |     0.2156 |
| 10,000 independent TRS animators  |      7.4819 |     5.6874 |
| 10,000 quaternion crossfade poses |      0.8348 |     0.4213 |

Browser matrix samples are short and timings are machine-specific. Improvements are workload-dependent. The 1,000-character complete frame still exceeds a 16.7 ms CPU budget; this does not establish 60 FPS.

## Validation and reproduction

131 tests across 40 files, strict TypeScript/production build, full production-preview GPU regression, independent GPU benchmark matrix, animation/crossfade CPU benchmarks and formatting checks pass. Tests cover extreme quaternion magnitudes, zero quaternions, aliased outputs, immutable cached keys, arbitrary seeks/signs, reverse playback, STEP/cubic interpolation, independent controllers and crossfades. GPU regression covers static/animated image equivalence, morph/skin depth and shadows, bounds/visibility and resource reuse.

```sh
pnpm test
pnpm run build
pnpm run profile:animation current
RENDERER_PREVIEW=1 pnpm run validate:gpu
pnpm run benchmark:gpu
pnpm run benchmark -- tests/animation.bench.ts tests/blending.bench.ts --outputJson artifacts/animation-cpu.json
```

Profiling requires installed Chrome and a WebGPU adapter. It owns port 5190 and writes a summary plus a Chrome `.cpuprofile` under `artifacts/`. Sampling and GPU diagnostics stay outside ordinary frame execution.

Raw evidence: `results/animation-optimization.json`, `animation-before-cpu.json`, `animation-after-cpu.json`, `animation-before-matrix.json`, `animation-after-matrix.json`, and `animation-regression.json`.

## Next measured targets

The crowd still spends about 6.2 ms updating transforms and 5.6 ms updating skeleton palettes. Those are the next complete-frame targets. Within animation, pose writes and dirty propagation now consume a larger share. Longer clips may benefit from per-controller keyframe cursors, provided seeks/reverse playback reset them correctly. Exact-time sample reuse could help synchronized crowds, but would need a bounded cache and a benchmark for independently phased playback. These are follow-ups, not implemented or assumed gains.
