# Codebase maintenance validation — 2026-10-05

This refactor separates responsibilities introduced by custom surface materials and makes imported data and demonstration startup easier to follow. The baseline is commit `d3f3e71` on `custom-shader-material`. Public application/renderer/material APIs and existing pipeline entry-point imports remain supported. GPU layouts, feature defaults, Phase 44 behavior and resource construction order are preserved.

## Scope and ownership

| Previous coordinator      |    Before |     After | Responsibilities moved                                                                      |
| ------------------------- | --------: | --------: | ------------------------------------------------------------------------------------------- |
| `createColorResources.ts` | 386 lines |  37 lines | WGSL assembly, binding setup and bounded pipeline construction                              |
| `ColorPass.ts`            | 383 lines | 233 lines | Serialized custom shader registration, parameter buffer and family preparation              |
| `convertRuntimeAsset.ts`  | 250 lines |  43 lines | Geometry/skin, material/texture, scene/animation conversion and normalized accessor copying |
| `MaterialManager.ts`      | 332 lines | 276 lines | Custom parameter validation, row storage and dirty upload range                             |

Line counts show coordinator size, not a reduction in total implementation. The new modules keep the same operations with explicit input/output contracts. `RuntimeAsset.ts` names each serializable record instead of embedding nested anonymous types. `createDefaultScene.ts` separates the default cube/sun fixture from application lifecycle. `installExample.ts` separates URL-driven example selection from browser startup and cleanup, retaining lazy lighting/shader imports.

The existing animation, math, visibility, bounds, deformation and queue kernels already have focused ownership. They were reviewed and retained to avoid introducing allocations or dispatch overhead into profiled loops. Browser regression callbacks remain self-contained for Playwright serialization. The architecture guide now maps common changes to their owning modules and describes cold setup, shared resource identity, worker-transfer ownership and maintenance constraints.

## Validation by stage

Each implementation stage passed its checks before the next began:

1. Color setup/custom registration: strict production build, 237 existing tests, custom-material browser validation and long-animation GPU matrix; all 86 baseline work/resource snapshots matched.
2. Asset conversion/material parameter owner: strict production build, existing tests, browser asset-lifecycle, codec and custom-material validation; GLB decoding and material CPU benchmarks completed.
3. Default scene/example selection: lint, strict production build, game, environment and custom-material browser validation; gameplay CPU benchmarks completed.

Final checks pass **240 tests across 61 files**, lint with zero warnings, formatting and the production build. The complete `pnpm run validate` gate passes GPU rendering, asset lifecycle, gameplay, scene features, custom materials, HDR, quality, post-processing, device recovery, environments and codecs. The independent `--long-animation` benchmark passes reference-image assertions with no page errors.

Three new regression tests cover independent decoded array ownership across parser mutation/multiple conversions, malformed geometry/skin/animation rejection at the pure conversion boundary, and lazy/failed custom parameter uploads. A failed synchronous queue write leaves rows pending, clears upload diagnostics and allows a later retry. Public parameter arrays retain their identity.

The final matrix matches **all 86 work/resource snapshots exactly**, including draw/instance counts, upload bytes and creation/cache counters. All custom-material non-timing results also match the baseline: analytic pixels, direct/sorted/instanced/indirect equivalence, depth, masking/blending, HDR, deformation, recovery, warm resource stability and zero buffers after disposal. Changed custom rows still upload 64 bytes; unchanged rows upload zero.

## Measurements and limits

Production Chrome long-clip crowds use 1,024 keys, 64 joints and distinct per-character phases. CPU frame medians from the saved runs:

| Characters                  | Baseline | Refactored |
| --------------------------- | -------: | ---------: |
| 100                         |   2.7 ms |     2.8 ms |
| 500                         |  14.6 ms |    12.4 ms |
| 1,000                       |  27.1 ms |    26.4 ms |
| 1,000 with 16 morph targets |  29.9 ms |    28.6 ms |

The 1,000-character animation stage measured 9.4 ms before and 9.3 ms after. Custom-material encoding remained approximately 0.2 ms for each 1,000-cube instanced workload, with one draw and no unchanged parameter upload. These coarse, hardware-specific measurements fluctuate in both directions; this maintenance work makes no speedup claim. The largest crowd still exceeds a 16.7 ms CPU frame budget. GPU completion waits, mapped images and timestamps belong to the diagnostic harness and remain absent from ordinary rendering.

The targeted CPU runs measured 1.6888 ms mean for decoding a 10,000-vertex GLB, 0.2561 ms for 1,000 material updates, 0.0679 ms for 100 gameplay callbacks across 100 fixed frames, and 0.0286 ms for 1,000 collection-game steps. These are workload observations, not controlled before/after comparisons or universal budgets.

## Reproduction and saved evidence

```sh
pnpm run validate
pnpm run benchmark:gpu --long-animation
pnpm exec vitest bench --run tests/gltf.bench.ts tests/materials.bench.ts
pnpm exec vitest bench --run tests/game-api.bench.ts
```

Saved reports: [baseline long matrix](results/codebase-maintenance-baseline.json), [final long matrix](results/codebase-maintenance-final.json), [baseline custom materials](results/codebase-maintenance-materials-baseline.json), [final custom materials](results/codebase-maintenance-materials-final.json). Fresh execution logs remain under ignored `artifacts/restructure-*.log`.
