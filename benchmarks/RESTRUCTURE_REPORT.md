# Maintenance restructuring after particles — 2026-10-05

This pass reviewed application lifecycle, assets, animation/ECS, input, math, rendering/pass owners, shaders, browser harnesses and tests. It separates the remaining mixed cold/frame responsibilities after particle integration. The baseline is committed `70453f2`; feature behavior, public APIs/import paths and defaults remain compatible.

## Changes and ownership

- `shadows/createShadowResources.ts` owns fixed target/layer views, shared bindings and six prepared caster variants. A named input contract documents borrowed dependencies and dimensions. ShadowManager retains fitting, cache invalidation, visibility, packing and encoding.
- `particles/createParticleResources.ts` owns enable/recovery GPU setup. ParticleRenderer retains attached-owner lifetime, ordering, dirty uploads, grouping and counters. GPU destruction still belongs to Resources. Construction sequence, descriptors and shared identities are preserved.
- `particles/ParticleLayout.ts` names every spawn-field offset and the camera/time uniform size. CPU consumers capture immutable scalar constants once at module initialization. ParticleOptions re-exports existing size constants. The 112-byte record/uniform layouts and WGSL are unchanged.
- `rendering/copyRendererSettings.ts` owns cold CPU control replay with the original setter order; its Renderer dependency is type-only. Renderer retains its frame stamp, facade and execution sequence. Particle totals and unknown GPU-derived counters now have explicit private methods.
- `assets/AssetLoaderTypes.ts` owns cache/transaction contracts, re-exported from the loader. URL deduplication, deferred start, cancellation, leases, rollback, eviction and unload scheduling remain in AssetLoader. Updated comments explain lifecycle decisions rather than repeat statements.
- README, the particle guide and architecture map explain these boundaries and their preservation contracts.

Already focused application/input, conversion, animation, ECS/math, visibility, shader and test modules remain in place. Integrated `page.evaluate` callbacks preserve self-contained browser dependencies and cross-check state; ordinary imported Node helpers cannot be referenced by a serialized browser callback. No generic frame context, per-particle object, shader permutation, GPU synchronization or resource owner was added.

## Validation and equivalence

The setup extraction first passed targeted shadow/particle unit tests, production GPU regression, particle references and particle CPU workloads before the next changes. The final complete `pnpm run validate` passes lint, formatting, **249 tests across 64 files**, strict build and every GPU gate: rendering, assets, game API, features, custom materials, particles, HDR, quality, post-processing, recovery, environments and codecs. No checks were skipped after a failure.

The final long-animation matrix passes its reference assertions. Comparing before/final reports excluding environment metadata and measured timing fields yields **2,743 identical non-timing report values, including 86 work/resource snapshots**, including image differences, defaults, shared animation ownership, uploads, draws, cache/creation counters and disposal. The saved comparison records the excluded fields and has no differences. Disabled particle work stays zero.

Particle references match before/final for shapes, sorted alpha, additive and mixed groups, HDR, depth occlusion, recovery and bloom. Both runs retain one draw per blend-only stress case, zero unchanged record uploads and 112 bytes of camera/time upload. Warm resource counters do not change; tracked buffers/textures reach zero and browser/GPU error lists remain empty. Production particle timing still reports alpha encoding medians of 0.1/0.2 ms for 1,000/4,000 particles; additive medians round to 0.0 ms. Diagnostic completion medians are 0.6–0.8 ms. Coarse browser timing does not imply zero work, and completion includes diagnostic queue fencing.

A syntax comment audit finds explanations for all 2,329 implemented functions/callbacks in 339 source/test/script/shader files. The audit checks comment presence; it does not prove semantic equivalence. Type checking, unit assertions and production GPU references provide that evidence.

## CPU measurements and rejected intermediate

The full before/final Vitest benchmark suite completes successfully; saved reports contain 80 unique workload rows. Selected mean times in milliseconds:

| Workload                                                   |  Before |   Final |
| ---------------------------------------------------------- | ------: | ------: |
| 1000 analytic particle lifetime ticks                      |  0.0084 |  0.0016 |
| 10000 analytic particle lifetime ticks                     |  0.0846 |  0.0177 |
| 1000 particle burst records                                |  0.0882 |  0.0808 |
| 10000 particle burst records                               |  0.8853 |  0.8112 |
| load/unload 100 decoded assets with a 16-record LRU budget |  0.2002 |  0.2035 |
| 1000 characters x 64 joints, 1024 LINEAR keys              | 11.5028 | 11.0416 |

The intermediate layout extraction using named imports measured 0.2598 ms for the 10,000-record lifetime scan and 2.9666 ms for burst writing, versus 0.0846/0.8853 ms at baseline. That version was not accepted. Capturing immutable constants once outside the hot loops removed repeated imported-value access; the final full-suite measurements above confirm the slowdown is resolved. This also preserves named layout definitions without adding runtime lookup tables.

Lifetime scans use zero elapsed time/no expiration; bursts reuse a fixed seeded pool. These CPU workloads exclude rendering and sorting. Browser 1,000-character long-clip CPU frames measured 28.3 → 27.3 ms, with unchanged work counters. Animation code did not change, so variation there is not attributed to this refactor. Full-rate crowds still exceed a 60 FPS budget. Measurements are observations on this machine, not universal speedup or budget guarantees.

## Reproduction and saved evidence

```sh
pnpm run validate
pnpm run benchmark:gpu --long-animation
pnpm exec vitest bench --run
```

Saved reports: [GPU baseline](results/restructure-matrix-before.json), [GPU final](results/restructure-matrix-final.json), [equivalence comparison](results/restructure-comparison.json), [particle baseline](results/restructure-particles-before.json), [particle final](results/restructure-particles-final.json), [CPU baseline](results/restructure-cpu-before.json), [CPU final](results/restructure-cpu-final.json). Local staged/final logs are in `artifacts/restructure-*.log`. See [ARCHITECTURE.md](../ARCHITECTURE.md) for the updated module map.
