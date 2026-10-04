# Asset failure cleanup and lifecycle — 2026-10-04

This implements the first improvement recommendation: transactional uploads, cancellation, whole-asset unloading and bounded unused-asset caching. The required phases remain complete; Phase 44 stays optional and disabled by default.

## Behavior and ownership

Uploads retain their ownership locally until all primitives succeed. Failure after an earlier primitive, material creation, texture preparation, buffer allocation or buffer write reclaims completed resources and arena ranges. Material IDs become reusable after fencing; mesh/entity IDs remain monotonic. Texture preparation arrays carry shared texture leases, so another asset using the same content keeps its textures alive.

`Application.loadAsset(url)` retains the cached asset and records every node and primitive entity it creates. `await app.unloadAsset(url)` preflights external consumers, removes all application-created instances for that URL, retires animation/morph/skeleton state, refreshes the render snapshot, fences submitted GPU work and releases decoded/GPU resources. Foreign entities, hierarchy attachments, LOD groups, streaming fallbacks and material bindings veto unloading before removal. Manually destroyed instances can still be unloaded successfully. Failed instantiation removes partial entities and attached runtime state.

Cold registry compaction remaps ECS IDs. Surviving controller objects, morph views and joint/delta offsets stay valid. Free arena ranges coalesce and are reused without moving live allocations. This also lets streaming mesh eviction reclaim morph deltas.

Cancellation applies to a shared URL operation. Fetch receives an abort signal; worker cancellation removes only that job and ignores late responses. Uploads check cancellation/device availability at asynchronous boundaries. A late successful upload is released instead of published. Synchronous decode/primitive packing is not preempted. Cleanup failures retain ownership for retry and block reloading until cleanup completes. Application disposal is asynchronous and cancels/cleans assets before renderer/device destruction.

The default cache budget is 64 records / 128 MiB of decoded backing buffers. Counts deduplicate aliased backing buffers within an asset. LRU eviction releases unused whole assets; retained/pending/latest loads remain protected and may exceed the budget. Byte accounting excludes GPU memory and JavaScript metadata. Empty failure/inspection records and per-record state history are bounded. World entity IDs continue consuming the configured capacity after destruction, preserving the existing stale-ID contract.

## Validation

155 tests across 43 files and the strict TypeScript/production build pass. Added coverage exercises rollback, partial allocation/write failures, cancellation at stage boundaries, late uploads/worker replies, cache budgets, failed cleanup retries, external consumers, failed instantiation, palette/state preservation, arena reuse, manually destroyed instances and fence ordering.

`pnpm run validate:assets` uses real Chrome WebGPU against the production build. It validates an intentional second-primitive failure after texture preparation and a successful first primitive; all live resource counts return to baseline. It then loads two independent asset URLs, with two instances for the first URL, and checks that unloading the first preserves the other character and shared textures. Ten subsequent skinned/morphed/textured load/draw/unload cycles each return to the same baseline:

- 36 shared buffers / 61,085,312 buffer bytes, five fallback/render textures;
- one bootstrap mesh/material, two bootstrap/light entities;
- zero asset texture cache entries, delta allocations, skeletons, morph states or animators.

Every repeated loaded image has the same hash. The unloaded image matches the original baseline. LRU eviction leaves only the latest unused asset; native network cancellation returns `AbortError`, creates no scene entities and leaves no cached record. GPU validation and page errors are zero.

The full production-preview renderer regression and independent GPU benchmark matrix pass. Draw/deformation/upload counters and warm resource statistics match the prior round-two matrix exactly. No ordinary-frame waits, readbacks or GPU resource allocations were introduced.

## Measurements

Fresh CPU baseline was captured before editing. Final focused CPU measurements ran independently of the GPU benchmarks:

| CPU workload                         | Before (ms) | After (ms) |
| ------------------------------------ | ----------: | ---------: |
| Parse/convert 100,000 vertices       |     28.0594 |    27.9870 |
| Pack 100,000 vertices, no GPU upload |      5.5601 |     5.5805 |

Differences are within measurement noise; this change makes no packing speedup claim. The intermediate rollback-only packing mean was 5.6640 ms and is retained in the raw evidence.

New lifecycle CPU workloads measure 0.2039 ms for 100 mock decoded asset loads/unloads under a 16-record budget, and 1.8488 ms for 1,000 fragmented arena allocations/releases. These exclude actual fetch/decode/GPU work and have no preexisting lifecycle baseline.

For the tiny real skinned/morphed/textured fixture, ten browser cycles measure a 3.9 ms median load and 0.3 ms median unload, including the asynchronous fence. These local Chrome/Apple GPU measurements are not throughput or frame-time guarantees; large assets and queued GPU work can take longer.

## Reproduction and evidence

```sh
pnpm test
pnpm run build
pnpm run validate:assets
RENDERER_PREVIEW=1 pnpm run validate:gpu
pnpm run benchmark:gpu
pnpm run benchmark -- tests/asset-loading.bench.ts tests/asset-lifecycle.bench.ts --outputJson artifacts/asset-lifecycle-final-cpu.json
pnpm run format:check
```

Tracked raw evidence is under `benchmarks/results`: `asset-lifecycle.json`, `asset-lifecycle-before-cpu.json`, `asset-rollback-after-cpu.json`, `asset-lifecycle-after-cpu.json`, `asset-lifecycle-gpu.json`, `asset-lifecycle-regression.json`, and `asset-lifecycle-matrix.json`.
