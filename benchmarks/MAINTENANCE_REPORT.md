# Maintenance restructuring after game integration

The refactor separates setup/lifetime responsibilities across the application, renderer, animation, workers, input and post-processing. Public APIs/import paths, GPU layouts, shared resource identities, morph → skin → model ordering, feature defaults and optional Phase 44 behavior remain compatible.

| Boundary        | Result                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer        | createRendererResources builds shared buffers and dependent pass owners in original GPU order; Renderer retains aliases/disposal. Frame methods name shared writes, optional GPU preparation and upload statistics. |
| Application     | prepareScene and submitFrame preserve profiler spans/update order and one submission. ApplicationPicking owns reusable scratch and live identity checks.                                                            |
| Animation       | AnimationBindings defines persistent records and cold layer installation. Animator retains original binding construction and sampling/composition loops; MorphState remains exported compatibly.                    |
| Input           | InputScope owns listener/focus/visibility cleanup while gesture owners retain capture, CSS state and deltas.                                                                                                        |
| Workers         | Shared request/reply contracts describe producers and consumers. AssetDecoder separates startup, restoration and failure from dispatch/cancellation.                                                                |
| Post-processing | Dedicated reduction/adaptation and presentation factories keep descriptors/shader assembly outside target/frame owners; arithmetic is unchanged.                                                                    |

The repository guide maps the owners and corrects stale descriptions of worker preparation and post-processing order. Small focused math, ECS, visibility, cache, sampler, geometry and pass modules retain their responsibilities. Comments explain cold/frame boundaries and ownership.

Validation passes 232 tests across 60 files, strict build, formatting and every production GPU suite. Added tests cover worker failure/retry/retired replies and listener cleanup preserving unrelated subscriptions. Existing suites cover images, transfer/cancellation, identity reuse, real mouse/touch input, recovery, disposal and warm resource stability.

## Browser matrix

Baseline is the committed game-improvement matrix from 445c187. Final long-animation reference-image assertions pass with no page errors; all 86 work/resource snapshots match exactly. Timing jobs run separately from validation and CPU benchmarks.

| Workload                             | CPU before / after (ms) | Diagnostic completion before / after (ms) |
| ------------------------------------ | ----------------------: | ----------------------------------------: |
| 1 characters × 64 joints             |               0.1 / 0.1 |                                 0.7 / 0.6 |
| 100 characters × 64 joints           |               2.4 / 2.5 |                                 3.7 / 3.7 |
| 500 characters × 64 joints           |             12.8 / 13.0 |                               14.9 / 15.2 |
| 1000 characters × 64 joints          |             25.4 / 25.0 |                               28.9 / 28.5 |
| 1,000 × 64 joints + 16 morph targets |             27.2 / 27.0 |                               32.1 / 32.0 |

## CPU comparison

Older CPU timings varied, so the committed source was exported to a temporary checkout and benchmarked sequentially against the final refactor with identical dependencies. The final comparison keeps that checkout outside repository test discovery. Original animation binding construction was retained after exploratory extraction timings showed sensitivity; no abstraction was added to sampling loops.

| CPU batch                                                       | Committed / refactored mean (ms) |
| --------------------------------------------------------------- | -------------------------------: |
| 1000 x 64 joints, explicit staggered 15 Hz poses / 60 Hz clocks |                  3.1601 / 3.2983 |
| 100 characters x 64 joints, 1024 LINEAR keys                    |                  0.4832 / 0.4786 |
| 500 characters x 64 joints, 1024 LINEAR keys                    |                  5.0188 / 4.4878 |
| 1000 characters x 64 joints, 1024 LINEAR keys                   |                10.8368 / 10.8740 |
| 1000 TRS + 16 morph weights, 256 STEP keys                      |                  0.2000 / 0.1996 |
| 1000 TRS + morph crossfades, 256 STEP keys                      |                  0.8377 / 0.8914 |
| 1000 TRS + 16 morph weights, 256 LINEAR keys                    |                  0.2433 / 0.2400 |
| 1000 TRS + morph crossfades, 256 LINEAR keys                    |                  0.9317 / 0.9397 |
| 1000 TRS + 16 morph weights, 256 CUBICSPLINE keys               |                  0.2602 / 0.2586 |
| 1000 TRS + morph crossfades, 256 CUBICSPLINE keys               |                  0.9044 / 0.9525 |
| 1000 orbit updates                                              |                  0.0816 / 0.0812 |
| 1000 follow updates                                             |                  0.0658 / 0.0655 |
| 1000 standard gamepad polls (provider cost excluded)            |                  0.2645 / 0.2632 |

Measurements vary in both directions; this is not a universal speedup claim. Full-rate crowd frames still exceed the 60 FPS budget. Browser completion includes diagnostic waits and gamepad CPU timing excludes native polling. Raw evidence: results/maintenance-{final-matrix,cpu-baseline,cpu-final}.json; baseline: results/game-improvements-final-matrix.json.
