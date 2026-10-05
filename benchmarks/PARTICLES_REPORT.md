# Particle and visual-effect validation — 2026-10-05

The optional particle system adds analytic GPU billboards with seeded emitters and one-shot sparks, smoke, explosions, confetti and shockwaves. It starts disabled, preserving default scene rendering and allocating no particle GPU resources. Application-owned CPU provenance survives device recovery; renderer-owned buffers/pipelines follow existing resource lifetime.

## Architecture and correctness

A fixed pool stores seven vec4 values per particle (112 bytes): origin/birth, velocity/lifetime, gravity/drag, start/end RGBA, size/rotation/spin and shape/blend/fades. Each birth writes a record; dense retirement can move the final live row. Normal motion changes time rather than uploading vertex data. Continuous emitter counts retain fractional remainder, discard overflow without backlog and stay bounded by capacity. Installation copies settings and validates values before mutation.

The GPU owner prepares one spawn table, one index-order table and a 112-byte camera/time uniform, plus four retained pipelines for alpha/additive and direct/half-float targets. Default GPU storage is 475,248 bytes at 4,096 particles. No per-particle GPU objects, textures, shader recompiles, compute dispatches or normal-frame readbacks are introduced. Alpha centers use persistent stable radix ordering; additive particles skip sorting. At most two instanced draws generate billboard vertices procedurally. Empty/disabled systems encode no particle GPU pass. GPU objects are retained while disabled and released at renderer disposal.

The render graph versions color through scene → particles → post-processing → presentation. Particle depth testing is read-only. HDR/bloom/exposure/FXAA receive the composited particle radiance. Existing callback sets remain valid because the particle callback is optional. Geometry clusters, shadows and scene-mesh visibility remain separate.

Validation passes **249 tests across 64 files**, lint, formatting, strict production build and every production GPU gate, including the new `validate:particles` scenario. New unit checks cover capacity/overflow, expiration/reuse, immutable spawn records during motion, pause, settings copies/atomic validation, deterministic seeds, fractional emission, disposal, presets, enable-time setup, signed-depth/tie radix sorting and compatible graph ordering.

The browser scenario checks all four shape coverages, analytic linear color, alpha sorting in both camera directions, additive accumulation and mixed-group indices/counters, GPU motion and fades, opaque scene occlusion, disabled feature behavior, HDR/bloom, FXAA-only targets, resize, recovery, warm reuse, sample controls and teardown. Opaque-depth and recovery image differences are zero. Bloom changes the image, confirming particles precede its input. Unchanged live records upload zero bytes; unchanged ordering leaves only the 112-byte camera/time update. Warm creation/cache/resource counters remain unchanged; final tracked buffers and textures are zero. No browser/GPU errors occur. The game guide's playable sample with the new emitter snippet compiles and passes movement, collection, reset and disposal checks.

The independent long-animation matrix passes reference assertions and preserves **all 86 existing work/resource snapshot fields** against the committed maintenance baseline. New particle counters are zero in disabled workloads. Existing material, deformation, visibility and resource work is unchanged.

## Measurements

Production Chrome, 640 × 480, small square billboards distributed through a world-space box, no scene mesh, forty measured frames after warmup. CPU encoding includes the renderer's ordinary preparation and particle ordering. Diagnostic completion includes queue submission/fencing; it is not an isolated GPU particle-pass timestamp. Records and ordering remain unchanged after warmup.

| Blend    | Particles | CPU encoding median | Diagnostic completion median | Draws | Record upload | Total particle upload |
| -------- | --------: | ------------------: | ---------------------------: | ----: | ------------: | --------------------: |
| Alpha    |     1,000 |              0.1 ms |                       0.7 ms |     1 |           0 B |                 112 B |
| Alpha    |     4,000 |              0.2 ms |                       0.8 ms |     1 |           0 B |                 112 B |
| Additive |     1,000 |     reported 0.0 ms |                       0.7 ms |     1 |           0 B |                 112 B |
| Additive |     4,000 |     reported 0.0 ms |                       0.7 ms |     1 |           0 B |                 112 B |

Zero medians reflect coarse browser timing, not zero CPU work. Lifetimes still require a bounded CPU scan and alpha centers require ordering. The unit CPU workload measured mean lifetime scans of 0.0085 ms for 1,000 records and 0.0846 ms for 10,000, with zero elapsed time/no expirations. Reusing the pool to write complete seeded bursts measured 0.0885 ms and 0.8875 ms respectively. These workloads exclude rendering and do not establish whole-game budgets or universal performance.

Large overlapping particles, alpha ordering, changed indices, high emission/retirement, drag and post effects increase cost. Births/compaction can widen dirty record ranges; changed order costs four bytes per live particle. Sprite textures/atlases, collision, ribbons/trails, soft depth-intersection fades, mesh particles, arbitrary particle shaders, shadow casting and globally interleaved mesh/particle transparency are outside this implementation. Center sorting approximates large/intersecting billboards. Offscreen particles still incur vertex work before clipping. Use one active GPU renderer per system.

## Reproduction and evidence

```sh
pnpm run validate
pnpm run validate:particles
pnpm exec vitest bench --run tests/particles.bench.ts
pnpm run benchmark:gpu --long-animation
```

Saved evidence: [particle scenario](results/particles.json), [CPU workloads](results/particles-cpu.json), [disabled long-animation matrix](results/particles-disabled-matrix.json), [existing baseline](results/codebase-maintenance-final.json). Working logs are under `artifacts/particles-*.log`. See [PARTICLES.md](../PARTICLES.md) for the API and supported controls; open `/?example=particles` for a working demonstration.
