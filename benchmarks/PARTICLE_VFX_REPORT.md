# Particle effects extension — 2026-10-05

The clean baseline was `ab2c31f`. The user requested sprite atlases/flipbooks, soft depth-intersection fades, directional emission, lifetime curves and connected ribbons/trails. All five are implemented; the amendment in IMPLEMENTATION_PLAN supersedes the original exclusions for these features. Existing particle enablement defaults, public imports, seeded procedural behavior and mesh rendering remain compatible.

## Ownership and performance boundaries

One copied, evenly tiled RGBA8 atlas and a fixed 64-profile/four-key curve table serve every emitter. Sprite playback and piecewise lifetime multipliers run in vertex shading; atlas sampling and optional camera-depth fades run in fragment shading. Default identity curves bypass profile reads, and procedural vertices skip atlas-coordinate calculations. Cone/sphere emission samples seeded directions only at birth, with a precomputed basis and no per-particle objects.

Trail controllers retain bounded point rings. Changed histories pack into a persistent segment table with neighbor coordinates; vertex shading builds connected camera-facing miter strips and ages each endpoint. No CPU vertices, per-point GPU resources, production readbacks or queue waits are added. Fixed shared ribbon buffers and four additional pipeline variants are prepared at first controller installation/enablement/recovery. The shader, frame, curves and sampled depth are shared. At most two billboard draws plus two ribbon draws occur. Warm resource snapshots remain stable.

Atlas pixels, curve IDs, live births and trail histories survive device recovery. Renderer Resources owns GPU destruction. Atlas replacement validates active ranges before changing CPU provenance. Controller histories can clear independently; disposing a trail immediately removes its geometry and frees its slot.

## Validation

Features passed staged tests, GPU references and CPU benchmarks before the dependent ribbon work advanced. Final `pnpm run validate` passes lint, formatting, strict build, **256 tests across 66 files**, and every production GPU gate. The extended particle gate also passes its final stress scenarios after the complete gate.

New checks cover copied atlas data and atomic range rejection, explicit-FPS looping and lifetime playback, shared curve interpolation/validation, deterministic cone/sphere launch bounds, malformed input, ring wrap/eviction, pause/expiry, independent cleanup and capacity errors. Browser references verify sRGB frames, lifetime tint/alpha, soft fades in perspective and orthographic cameras, ribbon coverage/miter joins, opaque occlusion, soft ribbon depth fades, alpha/additive group offsets, active texture/profile/ribbon recovery, resize, HDR/bloom/FXAA, demo controls, warm resource reuse and complete teardown. GPU/browser errors are empty; tracked buffers and textures reach zero.

The saved long-animation matrix matches **2,743 existing non-timing values** from the committed restructuring baseline (subsequent baseline source changes only added comments). This includes mesh/animation references and resource/work snapshots. All 72 occurrences of the two added ribbon counters are zero in scenes without effects. Original particle shape/color/blend/HDR/occlusion/bloom reference values match the fresh baseline; no regressions were excluded. Timing/environment fields are explicitly excluded from equality comparison.

## Measurements and costs

CPU means in milliseconds, measured on this machine with reused pools/controllers:

| Workload                                         | Before |                Final |
| ------------------------------------------------ | -----: | -------------------: |
| 1,000 lifetime scans, no retirement              | 0.0016 |               0.0019 |
| 10,000 lifetime scans, no retirement             | 0.0177 |               0.0199 |
| 1,000 default births                             | 0.0796 |               0.0923 |
| 10,000 default births                            | 0.7988 |               0.9235 |
| 10,000 directional cone births                   |      — |               1.8325 |
| Append/pack eight full histories, 1,016 segments |      — |               0.0982 |
| Clock-only scan, same histories                  |      — | approximately 0.0001 |

The larger record and extra metadata have a measurable CPU cost: approximately 16% more time for this 10,000-birth workload. This extension is not a claim of faster default emission. Records grew from 112 to 144 bytes and the frame uniform from 112 to 144 bytes. Default enabled billboard GPU buffers now total 615,568 bytes, versus 475,248, plus one atlas texture (white 1×1 fallback). The fixed curve buffer is 9,216 bytes. First trail installation adds 601,472 GPU buffer bytes at default 32×128 history limits. CPU snapshots/ordering are bounded up front, with individual history rings allocated at controller creation. Disabled effects still allocate no particle GPU resources and encode no particle work.

Production browser diagnostics use 40 measured frames after warmup. Combined atlas/curve/soft effects at 1,000/4,000 particles encode at approximately 0.0/0.1 ms median, with diagnostic fenced completion around 0.6/0.9 ms. A 1,016-segment additive ribbon workload uses one draw; encoding rounds to 0.0 ms. These coarse timings do not mean zero work. Fenced completion includes other scene work and synchronization performed only by the benchmark. They are observations, not universal frame-budget guarantees.

Every steady workload uploads **144 bytes**, no unchanged birth/history records, and creates no tracked GPU resources. Changing alpha order adds four bytes per item; births, compaction and history edits upload their dirty intervals. The remaining limits include fill-rate/overdraw, separate billboard/ribbon alpha sorting, center/midpoint ordering, sharp/edge-on trail overlap, no collision/mesh particles/arbitrary particle shaders, and atlas mip-zero minification aliasing. Keep art size, emission rate, lifetimes and history budgets appropriate for the game.

## Reproduction and evidence

```sh
pnpm run validate
pnpm run validate:particles
pnpm exec vitest bench --run tests/particles.bench.ts
pnpm run benchmark:gpu --long-animation
```

Saved evidence: [fresh particle baseline](results/particle-vfx-before.json), [final particle/GPU timings](results/particle-vfx-final.json), [CPU baseline](results/particle-vfx-cpu-before.json), [CPU final](results/particle-vfx-cpu-final.json), [long-animation final](results/particle-vfx-matrix-final.json), and [reference comparison](results/particle-vfx-comparison.json). Staged/final logs are retained locally under `artifacts/vfx-*`. See [PARTICLES.md](../PARTICLES.md) and [GAME_DEVELOPMENT_GUIDE.md](../GAME_DEVELOPMENT_GUIDE.md) for authoring and gameplay integration. The `/?example=particles` demo combines all five additions.
