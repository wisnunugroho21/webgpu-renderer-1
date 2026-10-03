# Refactor validation

The cleanup preserves the implementation plan's architecture and feature defaults. Phase 44 remains optional and disabled by default. Existing public application/renderer APIs and import paths remain available.

## Structural changes

- Renderer setup is split into bootstrap geometry, canonical vertex layout, cold color resources, and graph dependency configuration. `Renderer.encode()` now shows visibility, batching, shared upload, and execution stages explicitly.
- Asset upload is separated from browser lifecycle. Cold primitive helpers handle missing flat normals and glTF topology conversion; mesh ownership/upload remains in `MeshManager`.
- Extraction names its light, morph-weight, and joint-palette stages. CPU/GPU strides and instance/vertex offsets are named and documented beside their matching WGSL layouts.
- All 20 shaders use readable block formatting and comments around deformation, normal transforms, conservative visibility, storage layouts, and fallback behavior. Their non-comment code is unchanged.
- GPU drivers are reduced from 4,637 to 159 lines and from 788 to 38 lines. Browser scenarios, report assertions, and isolated server readiness/shutdown have separate modules. The integrated regression scene remains stateful to exercise shared assets and transitions across feature checks.
- Prettier configuration and `format`/`format:check` commands cover maintained source. A token-preserving WGSL formatter covers shader whitespace. `ARCHITECTURE.md` explains module ownership, frame ordering, ABI changes, resource lifetime, and validation.

`Renderer.ts` is reduced from 974 to 710 lines. Small modules already organized around a single responsibility remain intact.

## Validation

All 129 tests across 40 files, strict TypeScript checking, production build, formatting checks, production-preview Chrome WebGPU regression, and the independent GPU benchmark matrix pass.

The before/after comparison asserts identical compiled graph order, camera resource statistics, matrix work counters and resource counts, and the image hashes for individual/sorted/instanced/BVH draw workloads. GPU validation reports no errors. Feature-specific GPU assertions also retain full-image equivalence and conservative visibility checks, including optional geometry clustering and combined morph/skin paths.

No new frame readbacks, waits, GPU resource construction, per-object buffers, or CPU vertex deformation were introduced. Comments and formatting do not change shader code.

## Performance evidence

CPU benchmarks compare the original tracked checkout with the refactored checkout using the same installed dependencies and local machine. Browser baselines were captured before editing. Measurements are sequential; benchmark mocks, small warm samples, timer quantization, and scheduling limit interpretation.

A failed intermediate version looked up named vertex offsets through imported module properties inside the packing loop. It regressed 100,000-vertex cold packing from approximately 5.5 ms to 29.5 ms. Resolving offsets before the loop restored baseline performance before acceptance. Shared record strides similarly use immutable local bindings in upload loops.

Representative CPU means:

| Workload                                    | Before (ms) | After (ms) |
| ------------------------------------------- | ----------: | ---------: |
| Pack 100,000 vertices, mock GPU upload      |      5.5257 |     5.4756 |
| Extract 10,000 renderables                  |      0.9101 |     0.9148 |
| Upload unchanged joint ranges, mock queue   |      0.0067 |     0.0066 |
| Upload all changed joint ranges, mock queue |      0.0111 |     0.0112 |
| Upload 100 sparse joint changes, mock queue |      0.0140 |     0.0142 |

Browser timings and every CPU workload are recorded in `results/refactor-comparison.json`. They establish preserved work/resource behavior, not a universal speedup. In particular, short browser CPU medians can vary by tenths of a millisecond; timing variation is retained in the report rather than hidden or treated as exact equivalence. The combined 1,000-character stress workload remains animation-bound.

The 1,000-character/16-target morph row measured 0.8 → 1.1 ms CPU median, while GPU completion stayed at 4.8 ms. The combined morph/skin workload measured 38.9 → 38.7 ms CPU median. These short-sample observations are reported as limits of the comparison, with no claim that every workload became faster.

Raw evidence:

- `results/refactor-before-cpu.json` and `refactor-after-cpu.json`
- `results/refactor-before-matrix.json` and `refactor-after-matrix.json`
- `results/refactor-regression.json`
- `results/refactor-comparison.json`
