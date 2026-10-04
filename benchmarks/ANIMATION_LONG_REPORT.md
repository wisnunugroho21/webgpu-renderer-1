# Long-clip animation benchmarks and key lookup optimization

Implemented the third improvement recommendation on 2026-10-04. The original short-clip A–G matrix remains available. A separate mode adds a 30-second, 1,024-key glTF clip, 64 distinct joint curves and one distinct playback phase per character. It measures 1/100/500/1,000 characters with 60 warm-up and 60 measured frames, rather than the original five measured frames. Immutable clip/skeleton assets remain shared; playback and palettes remain independent.

## Change and correctness

AnimationSampler accepts an optional lower-key hint and returns the resolved index. Animator keeps this scalar on each clip/channel binding. Sampling checks the hinted interval and at most one neighbor in either direction, then falls back to binary search. Large jumps, seeks and wraps therefore remain O(log keys), rather than walking the timeline. One- and two-key samplers bypass hint bookkeeping. No frame skipping, time quantization, shared character poses, CPU deformation, normal-frame allocations, GPU waits or readbacks were added.

All interpolation arithmetic is preserved. New tests compare outputs exactly against stateless binary search for STEP/LINEAR/CUBICSPLINE, nonuniform keys, exact boundaries, clamped endpoints, rotations, 16 morph weights, invalid hints and independently phased callers. Controller tests compare long-clip TRS/morph playback through seeks, reverse loops, hitches, clip changes and interrupted crossfades. Single-key clips and malformed samples retain their validation.

The long GPU matrix re-samples each final pose without hints and compares complete rendered images: zero differing bytes at all four character counts. These diagnostic readbacks and reference wrappers run after timing/resource snapshots. All four long-crowd work/upload/resource snapshots match baseline. All 86 default matrix snapshots match the prior game API matrix. Shared clips/skeletons, one crowd draw, 64,000 joints and 4,096,000 joint upload bytes at 1,000 characters remain intact. Warm GPU resource creations remain unchanged; validation scopes, uncaptured GPU errors and page errors pass.

Final gates: 183 tests across 48 files, strict TypeScript/production build, formatting, production-preview renderer regression, original GPU matrix and expanded long GPU matrix pass.

## Timings

Chrome production-preview medians, milliseconds; CPU frame includes animation, transforms, palettes, bounds, extraction and encoding. Completion additionally waits for submitted GPU work and is diagnostic, not ordinary frame cadence.

| Characters | Animation before / after | CPU frame before / after | Completion before / after |
| ---------- | ------------------------ | ------------------------ | ------------------------- |
| 1          | below timer resolution   | 0.1 / 0.1                | 0.7 / 0.7                 |
| 100        | 0.8 / 0.8                | 2.4 / 2.4                | 3.5 / 3.5                 |
| 500        | 5.4 / 5.4                | 12.8 / 12.8              | 14.9 / 14.9               |
| 1,000      | 11.5 / 10.3              | 26.4 / 25.3              | 30.0 / 28.8               |

The 1,000-character row improves approximately 10% in animation and 4% in the complete CPU frame. Smaller rows show no measurable frame gain. The crowd still exceeds a 16.7 ms CPU budget.

Expanded Vitest CPU benchmarks share immutable curves and independently phased controllers. The 64-joint CPU fixture reuses one rotation curve across joints; the GPU fixture uses distinct curves. Mixed fixtures contain TRS and 16 morph weights, with 256 keys in each interpolation mode. Crossfade fixtures keep both clips running with a long fade, isolating steady blend cost; source phases differ, while destination clips start at time zero according to the public API. Dirty-list clearing is included; matrix propagation, extraction and GPU work are excluded from these CPU timings.

| CPU workload                             | Repeated baseline / optimized mean (ms) |
| ---------------------------------------- | --------------------------------------- |
| 100 characters × 64 joints, 1,024 keys   | 0.5374 / 0.4519                         |
| 500 characters × 64 joints, 1,024 keys   | 6.0590 / 5.3477                         |
| 1,000 characters × 64 joints, 1,024 keys | 12.7228 / 11.6132                       |
| 1,000 TRS + morph, STEP                  | 0.2605 / 0.1942                         |
| 1,000 TRS + morph, LINEAR                | 0.2676 / 0.2293                         |
| 1,000 TRS + morph, CUBICSPLINE           | 0.3085 / 0.2467                         |
| 1,000 crossfades, STEP                   | 0.8898 / 0.8520                         |
| 1,000 crossfades, LINEAR                 | 1.1160 / 0.8951                         |
| 1,000 crossfades, CUBICSPLINE            | 1.0866 / 0.9109                         |
| Original 1,000 two-key TRS animators     | 0.1965 / 0.1988                         |
| Original 10,000 two-key TRS animators    | 5.7395 / 5.7105                         |

Timing variation matters: the first comparison showed 12.3209 / 11.9981 ms for 1,000 long-clip characters, a much smaller gain. Its 500-character and LINEAR-crossfade results regressed; two-key bookkeeping was subsequently removed and the whole comparison repeated using the original runtime in a separate process. Final repeated expanded cases improve, while original two-key timings are essentially unchanged. Initial, intermediate and repeated results are retained; these measurements do not establish a universal speedup or threshold.

Animation-only Chrome profiling measures 10.3 / 10.0 ms before/after. It excludes transforms, palettes and GPU work and cannot be substituted for whole-frame timing. Pose writes remain the largest sampled cost; allocation/caching effects, JIT inlining and timer resolution limit attribution of individual sampled functions. Further large-crowd gains require addressing pose writes and subsequent preparation stages without degrading animation quality.

## Reproduce and evidence

```sh
node scripts/create-crowd-fixtures.mjs --long
pnpm run benchmark -- tests/animation-long.bench.ts tests/animation.bench.ts --outputJson artifacts/animation-long-cpu.json
pnpm run build
pnpm run benchmark:gpu --long-animation
pnpm run profile:animation current-long --long-animation
RENDERER_PREVIEW=1 pnpm run validate:gpu
pnpm run benchmark:gpu
```

The long mode writes `artifacts/benchmark-matrix-long.json`; default matrix output remains `artifacts/benchmark-matrix.json`. Profiling uses isolated port 5190, GPU matrix port 5188 and regression port 5187. Run timing jobs serially. Profile files remain diagnostic local artifacts. Regenerate original crowd assets without `--long`.

Machine-readable comparisons: [animation-long.json](results/animation-long.json). Supporting unchanged-stage CPU means: 10,000 quaternion pose blends 0.6724 ms, 10,000 dirty transforms 0.5241 ms, unchanged skeleton poses 0.1116 ms and all-changed poses 0.5986 ms. These are final-only observations, not additional speedup claims.

Raw CPU baselines/final/repeats, long baseline/final/default GPU matrices and full regression are retained as `results/animation-long-*.json`; profile summaries are `results/animation-profile-long-{before,after}.json`. Phase 44 remains optional/default-off.
