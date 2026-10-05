# Render-graph lifetimes and transient target reuse

Implemented compiled resource-version lifetimes, compatible transient texture slot planning, graph-owned physical leases and a device-local target pool. HDR scene, bloom and luminance resize targets use that pool. Persistent depth/Hi-Z, cached shadows and exposure state keep their existing ownership. See [RENDER_GRAPH.md](../RENDER_GRAPH.md) for contracts, integration and limits.

## Validation

The final `pnpm validate` gate passes **276 tests in 69 files**, lint, formatting, strict production build and all GPU scenarios, including `validate:graph`. Tests cover compiled ordering, inclusive overlap, exported lifetimes, compatibility defaults/mips/samples/usage/views, copied authoring inputs, invalid first writes, missing producers, partial allocation rollback, exclusive leases, completion quarantine, rejected fences, bounded idle retention, explicit cache clearing and teardown without resurrection.

The real GPU gate renders/captures red and green outputs in their respective lifetimes. Compatible nonoverlapping logical targets share one physical 8×8 RGBA8 texture and match the independent-target reference exactly: **512 logical bytes → 256 physical bytes**. Repeating preparation after completion requires zero new textures. HDR/bloom/automatic-exposure resize-back to 64×64 reuses **eight targets with zero new texture allocations**. Warm encoding creates no buffers, textures, pipelines, shaders or samplers. Disposal leaves zero tracked textures/texture bytes and zero active/retired/idle pool bytes. Existing post-effect analytic/image, resize and recovery gates remain passing.

A source function-comment audit reports no missing explanations among 2,616 functions in 360 files. Readbacks and explicit completion waits exist only in diagnostic/cold maintenance paths.

## Measurements

| CPU workload                                        | Mean ms |
| --------------------------------------------------- | ------: |
| Compile/analyze/color 100 transient targets         | 0.28866 |
| Execute 100 compiled empty callbacks 1,000 times    | 0.09071 |
| Original eight-callback workload, 10,000 executions | 0.49408 |

These are CPU benchmark means on the development machine. Compilation remains cold; frame execution performs neither analysis nor allocation. A frozen public schedule snapshot is separate from the private hot dispatch array. The original dispatch workload is retained alongside new planner workloads. The final warmed HDR/bloom/exposure browser fixture measures roughly **0.1 ms CPU encoding / 1.5 ms GPU completion**, with browser timing granularity and hardware-specific variation; no general speedup claim is made.

The production long-animation matrix passes its assertions and matches **2,908 existing non-timing values** from the authored-rendering baseline, with zero changed values. Resource/work/upload/visibility counters and reference images remain unchanged in existing scenarios. Pooling improves cold compatible-size allocation reuse; retention can increase live texture memory compared with immediately destroying every resized target.

## Bounds and ownership

Idle retention defaults to 64 MiB and 32 physical textures, with oldest-idle eviction. All active/quarantined/idle payload remains visible in ordinary texture accounting. Active/quarantined memory is not bounded by the idle cache cap; GPU backlog and rapid resize may temporarily retain additional allocations. Clearing idle storage is an explicit safe maintenance operation.

Exact-compatible, strictly nonoverlapping graph versions may share a GPUTexture; this is logical target reassignment, not low-level cross-format heap aliasing. First writers must clear/fully overwrite readable contents. Imported histories and cross-frame persistent data are excluded. Same-pass inputs/outputs cannot alias. Exported outputs live through graph completion, until next execution/disposal. Only declared transient targets enter graph allocation; existing renderer versions do not automatically become pooled allocations.

Release/configuration occurs between submissions. The completion fence covers already-submitted work, not command buffers retained and submitted later by the caller. Device loss/destruction invalidates old leases; custom graphs must reacquire/rebind targets against recovered Resources. Renderer HDR/post targets recover through existing control replay. No steady-frame pool acquisition, fence wait, bind-group creation or resource compilation is introduced.

## Evidence

- `benchmarks/results/render-graph-cpu.json`
- `benchmarks/results/render-graph-gpu.json`
- `benchmarks/results/render-graph-matrix.json`
- `benchmarks/results/render-graph-comparison.json`
- Ignored local logs: `artifacts/graph-final-validation.log`, `graph-tests.log`, `graph-cpu-final.log`, `graph-gpu.log`, `graph-matrix.log`, `graph-comments.json`.
