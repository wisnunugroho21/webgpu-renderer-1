# Animation preparation improvements

Transform setters now propagate dirty state after their existing validation rather than validate the same entity again. Already-dirty entities return before pushing a scratch stack: their descendants have already been marked. Dirty transform composition reads SoA scalar values directly through `Mat4.fromTRSValues`, eliminating ten temporary vector writes per entity while preserving arithmetic and float rounding. No animation quality reduction, time quantization or frame skipping is used.

Validation: 197 tests, strict build and full production GPU regression pass. The long-clip GPU matrix still compares full images against stateless sampling exactly; all four crowd counter/resource snapshots match baseline. The 1,000-character, 64-joint CPU median changes 25.8 → 25.4 ms (animation 10.6 → 10.3, transforms 4.1 → 4.1); completion 29.4 → 28.9. At 100/500 characters CPU frame changes 2.4/13.0 → 2.5/13.1 ms. Small differences and independent-run variability limit the conclusion; the crowd still exceeds a 16.7 ms CPU budget.

CPU microbenchmarks: 10,000 full dirty transform updates average 0.4983 ms; 100 dirty transforms 0.0050 ms. Long animation CPU-only means 11.1397 → 11.3673 ms for 1,000×64 joints, while LINEAR crossfades improve 1.2580 → 1.1066 ms. Some cases regress; this is a bounded preparation optimization, not a universal sampling speedup.

Reproduce with `pnpm test`, `pnpm run build`, `pnpm run benchmark -- tests/animation-long.bench.ts tests/ecs.bench.ts`, `pnpm run benchmark:gpu --long-animation`, and `RENDERER_PREVIEW=1 pnpm run validate:gpu`. Raw evidence: `results/remaining-animation-before-{cpu,matrix}.json`, `results/animation-preparation-{cpu,matrix,regression}.json`.
