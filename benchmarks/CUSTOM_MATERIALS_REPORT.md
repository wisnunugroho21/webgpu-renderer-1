# Custom surface material validation and performance

The extension adds registered WGSL RGB shading while preserving shared morph-before-skin geometry, material alpha coverage, PBR's 80-byte GPU ABI, texture roles, opaque batching, transparency, direct/indirect draws and Phase 44. Four vec4 parameter values live in one lazily allocated shared GPU table; changed rows upload through dirty-range tracking. Family-aware pipeline IDs use 16-bit queue/batch arrays. Compatible families share immutable layouts/frame groups. Compilation and bounded pipeline variants are cold operations; recovery replays retained CPU definitions.

## Correctness and lifecycle

The production material scenario passes analytic RGB references, invalid-WGSL rejection, concurrent registration/deduplication, masking/blending, all four submission modes, depth, environment-before-HDR setup, registration after optional setup, texture/skin/morph references, directional shadows, device recovery and disposal. A custom family reproducing PBR has zero differing bytes against PBR at matching pass/submission configurations. Comparing equivalent configurations matters for coplanar fixtures: enabling a depth prepass can change equal-depth winners even in the original renderer.

One custom parameter update uploads 64 bytes; the next unchanged frame uploads zero. Warm shader frames leave every tracked creation/cache/resource counter unchanged. One thousand objects sharing one material/mesh remain one instanced draw; two material/family groups remain two draws. Recovery reproduces the reference exactly and disposal leaves zero tracked buffers. No browser page errors or GPU errors occur.

The full validation gate passes, and final unit checks pass 237 tests across 61 files. The new tests cover registration contracts, failure nonpublication, limits, parameter validation/dirty ranges, material reuse, factor preservation, family IDs above 255, transparent LOD separation and custom-family geometry-cluster eligibility.

## Measurements

Chrome production preview, 640 × 480, 1,000 shared cubes: ten warmup frames then forty measured frames for each shader. Diagnostic completion includes an explicit GPU fence; normal rendering does not use that fence/readback. The saved run measured:

| Surface                    | CPU encoding median | Diagnostic completion median | Draws | Instances |
| -------------------------- | ------------------: | ---------------------------: | ----: | --------: |
| Built-in PBR               |              0.2 ms |                       0.9 ms |     1 |     1,000 |
| PBR-equivalent custom WGSL |              0.2 ms |                       0.9 ms |     1 |     1,000 |
| Unlit custom WGSL          |              0.2 ms |                       0.9 ms |     1 |     1,000 |

These timings are coarse, scene-specific diagnostic observations. They do not establish a universal speedup. The equivalent shader can be optimized by the GPU compiler, while real custom loops, texture samples and lighting work can increase cost. Registration/feature setup is intentionally outside these warm timings.

The independent pre-change/final GPU benchmark matrices pass reference assertions and preserve **all 86 work/resource snapshots exactly**. PBR material-scene CPU frame medians vary from 0.4–0.5 ms before to 0.3–0.5 ms after, with changes in both directions. No additional custom GPU buffer or shader/pipeline variants are allocated in a PBR-only application. CPU state does retain the parameter table and wider pipeline IDs. Geometry cold-preparation and queue/batching CPU benchmarks also pass.

## Limits and reproduction

Up to 16 custom families are retained per application material manager. There are no per-frame shader recompiles or per-object GPU buffers. Shader family identity can increase batch/pipeline diversity. The API supports RGB shading with existing texture roles; displacement, new discard rules, arbitrary bindings and custom vertex/fragment entry points require a separate multi-pass geometry/coverage extension. Definitions remain registered until application disposal.

```sh
pnpm run validate
pnpm run validate:materials
pnpm run benchmark:gpu
pnpm run benchmark tests/queues.bench.ts tests/geometry.bench.ts
```

Saved evidence: [custom material scenario](results/custom-materials.json), [baseline matrix](results/custom-materials-baseline.json), [final matrix](results/custom-materials-final.json). Timing variation across hardware/browser/runs is expected; use matching workloads/settings and work/resource assertions when comparing changes.
