# Maintenance restructuring — 2026-10-07

Baseline: `67800d050269b7bd22de2f4cd704d0aeb6b256bb`. This pass reviews the complete source/tooling layout after adaptive shadows, quality streaming, particle culling, TAA and transmission. Changes concentrate on coordinators with mixed setup/frame/policy/reporting responsibilities. Existing focused ECS, math, input, spatial, resource ownership, asset conversion, sampling and shader kernels remain in place. The restructuring preserves public imports, defaults, shared GPU layouts and ownership rather than mechanically moving every file.

## Ownership and reading order

| Entry point                                          | Focused responsibility                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Renderer`                                           | Public controls, shared GPU owners, resize/recovery and graph execution                              |
| `RendererVisibility`                                 | Feature prerequisites, CPU visibility/LOD, BVH revision and sorted batches                           |
| `RendererUploads`                                    | Frame stamp, instance offset, retained uniform scratch, ordered uploads and upload diagnostics       |
| `ApplicationScene`                                   | Profiled simulation-to-snapshot preparation, membership refresh and one-command-buffer submission    |
| `createAnimationBindings`                            | Cold channel/slot resolution and independent sampling outputs/key hints                              |
| `MaterialFactors`                                    | Complete factor/map validation followed by packing into the existing material row                    |
| `MaterialTextureLayout`                              | Authored UV layout packing and atomic validation of legacy/extended patches                          |
| `TextureQualityPolicy`                               | Frozen tier validation and projected demand observation in retained scratch                          |
| `TextureQualityStreaming`                            | Lifetime/generation checks, scheduling, reservations, async replacement, pressure and drain/disposal |
| `createTemporalResources` / `prepareTemporalTargets` | Cold bounded motion/resolve construction and persistent resize groups/targets                        |
| `TemporalAntialiasing`                               | History/jitter state, coalesced pose uploads, motion draws and temporal resolve                      |
| `createParticleAtlas`                                | Cold atlas upload and tile-safe mip generation                                                       |
| `scripts/gpu/assertions/`                            | Separate surface, deformation, lighting, visibility and asset/temporal checks                        |

Renderer helper classes are created once and borrow the current renderer's existing owners. No per-frame context objects, per-actor GPU objects, waits, readbacks or pipeline/target construction are added. Frame numbering and instance offsets move together, including recovery replay. Application helpers receive the current application, so device replacement cannot leave stale frame owners. Shader code and ABI values remain unchanged.

`RendererOptions` and `TextureQualityTier` have dedicated contracts, with their previous exports retained. Temporal record widths are named in `TemporalLayout` and resolved once outside tight object loops. MaterialManager still performs slot/shader checks before factor validation, publishes only after all validation succeeds, and retains revision/dirty-range ownership. GPU caches retain destruction ownership; history target arrays retain partial acquisitions for teardown.

Animation slot storage retains its original class construction order. Binding construction populates that caller-owned array and returns only clip bindings, avoiding an extra per-controller result container. Playback, events, layers and pose composition remain in Animator. Comments explain these ownership/performance boundaries; ARCHITECTURE and the game guide provide navigation.

## Coordinator sizes

| Module                  | Before | After |
| ----------------------- | -----: | ----: |
| Renderer                |    840 |   591 |
| Application             |    530 |   471 |
| Animator                |    492 |   459 |
| MaterialManager         |    374 |   230 |
| TemporalAntialiasing    |    522 |   384 |
| TextureQualityStreaming |    355 |   301 |
| ParticleRenderer        |    486 |   473 |
| regression-assertions   |    788 |    18 |

These counts describe narrower responsibilities, not removed functionality or reduced total code. The extracted modules are independently readable without changing public game APIs or adding directory-wide barrels.

## Validation

The final complete hardware `pnpm validate` passes lint, formatting, 317 tests across 80 files, strict TypeScript/production build and all eighteen GPU gates. The final long-animation matrix passes its references; a strict before/after comparison verifies 3,231 identical deterministic values, including pixels, batching, upload/work counters, warm resources and cold cache hits. No resource allocation deltas are allowed. An AST audit verifies all 289 original assertion calls retain identical arguments and order; none are weakened or removed. Browser scenario callbacks remain self-contained for Playwright serialization. Formatting and comments are checked separately from behavioral equivalence.

## Performance checks and rejected intermediate

Sequential Vitest workloads compare the committed source against the working tree using the same installed dependencies. The temporary baseline archive is kept outside test discovery and removed after comparison. CPU timings are diagnostic and include statistical variance; correctness/work/resource counts remain strict gates.

An intermediate change accessed named motion strides through live module bindings inside object loops. It increased pose-remap timings by about 35–39% in the Vitest runner and was rejected. Resolving immutable widths into local module bindings restores baseline packing cost. An initial benchmark archive under `artifacts` was also discovered as a second test tree; that run was discarded and the archive removed before current-source measurements. The final full CPU run also eliminates the large animation/queue outliers; those cases receive an additional isolated before/after check.

CPU evidence is in `benchmarks/results/maintenance-2026-10-07-cpu-comparison.json`; matrix/equivalence evidence is in `benchmarks/results/maintenance-2026-10-07-{matrix,gpu-comparison}.json`. Five focused bundled-Chromium SwiftShader gates also pass: custom materials, particles, temporal rendering, transmission and device recovery. GPU/browser error lists are empty; tracked resources dispose to zero. Development-machine timing does not establish universal performance or executed GitHub/Linux validation.

## CPU timing evidence

The final broad run covers 27 workloads. Most means are within six percent of the baseline; one small animation case has a 14.7% higher mean with variable timings and is included in a separate isolated confirmation. The isolated long-animation/queue pass measures 1,000 characters at 11.103 → 11.085 ms and the single-material queue at 1.487 → 1.492 ms. The 100-character confirmation has a lower mean (0.603 → 0.529 ms) but differing variance; its p75 moves 0.488 → 0.501 ms. These measurements support preserved work/throughput in the tested workloads, not a universal speedup claim.

Representative broad-run means, milliseconds:

| Workload                                          | Before |  After |
| ------------------------------------------------- | -----: | -----: |
| 1000 animators with 0 layers                      | 0.0669 | 0.0679 |
| 1000 animators with 4 layers                      | 0.3707 | 0.3703 |
| 1000 generational temporal pose remaps            | 0.1030 | 0.1028 |
| 10000 generational temporal pose remaps           | 1.1075 | 1.1011 |
| 1000 material records                             | 1.7077 | 1.7413 |
| 1000 optical material validation and packing      | 1.9425 | 1.9795 |
| 10000 visible objects texture-quality observation | 0.4421 | 0.4364 |

The final syntax comment audit covers 411 source/script/test/shader files and 2,926 implemented functions/callbacks, with zero missing explanations. This presence check is separate from the preserved-assertion audit and behavioral GPU/unit evidence. No GitHub workflow execution or universal timing guarantee is claimed.
