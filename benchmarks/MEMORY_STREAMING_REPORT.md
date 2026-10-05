# Memory accounting and budgeted streaming — 2026-10-05

This extension follows the particle VFX work already present in the workspace. It adds incremental GPU texture byte accounting, cold unique-backing-store recovery snapshots, and opt-in memory-aware authored LOD/material streaming. Existing loads, renderer feature defaults, resource descriptors and ordinary frame preparation retain their behavior.

## Implementation and scope

TextureMemory computes all levels rather than assuming base pixels × bytes/texel: compressed tail mips round to full BC/ETC2/EAC/ASTC blocks, array/cube layers stay constant and 3D slices shrink. TextureManager retains each allocation's estimate until retirement and updates texture/mip/compressed/target counters exactly once. Attachment and storage-output targets include depth/shadows, Hi-Z, HDR scene and post pyramids. Material textures used as mip-generation attachments remain assets. GPU total combines owned buffers and textures.

Explicit recovery-source boundaries expose mesh/deformation definitions, material runtime assets, environment data/cache, materials and particles/curves/atlas/trails. ArrayBuffer identities deduplicate aliased views and shared runtime definitions. Renderer/Application snapshots allocate temporary CPU collections only when called; no snapshots are performed per frame.

Streaming limits admission with a bounded priority/concurrency queue, estimated peak reservations and a serialized pressure-maintenance barrier. It evicts oldest unleased residents only after a cold fence and a final external-reference check. Pinned values keep their fallback bindings and can exceed a newly lowered ceiling. Actual-size validation precedes publication; rejected uploads are retired. Failed cleanup stays tracked for retry, and retirement prevents reacquisition of a dying GPU object. Application-wide accounting callbacks, budgets and existing streaming leases survive recovery. Legacy unbudgeted constructor/rebind call shapes remain accepted; budgeted owners need current memory accounting.

Budgets cover tracked streamed publication/residency, not hard driver VRAM. Accurate estimates prevent avoidable overshoot; unknown/underestimated uploads can temporarily exceed limits and then roll back. Ordinary asset/environment loading, render-target resize and custom allocation are tracked independently of replacement admission. Byte payloads exclude driver/object/pipeline overhead, swapchain storage, gameplay simulation arrays and transient decode/staging allocation. Depth-format storage is estimated. Whole authored LOD/material replacements are streamed; this does not provide sparse mip residency or automatically downgrade bound resources. See [the API guide](../MEMORY_AND_STREAMING.md).

## Validation

Targeted unit tests validate full/non-square/volume mip sums, array layers, sample multiplication, compressed edge blocks, exact-once destruction, storage/attachment target classification, aliased recovery memory, pre-load denial, pinned ownership, pressure eviction, priority/FIFO queue capacity, invalid controls, actual-size rollback, retryable cleanup and protection during asynchronous retirement.

Production `validate:memory` exercises the real texture uploader and streaming/material owners. A 32×32 RGBA8 material occupies **5,460 bytes**, including **1,364 additional mip bytes**; its encoded runtime definition adds retained recovery data. A second estimated request is refused before loading while the first remains bound. Releasing the first lets pressure eviction retire it before admitting the second. Lowering limits preserves the bound second texture until release; then trimming returns to baseline storage. A zero-estimate oversize upload rolls back without leaking resources or publishing a replacement. Device recovery preserves memory payloads and budgets; HDR enablement/resize updates target counters. On the test adapter, three 4×4 BC1 levels occupy **24 bytes** despite sub-block tail dimensions. All tracked GPU/texture/target bytes reach zero at disposal, with empty GPU/browser error lists.

The complete `pnpm run validate` passes lint, formatting, strict build, **262 tests across 67 files**, and every GPU gate including the new memory scenario. Comment-presence auditing covers every implemented function/callback. Production benchmark regression compares the existing mesh/animation work, references and resource identities against the preceding VFX matrix, with the newly added accounting fields explicitly separated from existing values. The final comparison matches all **2,815 existing non-timing values**, including image references and work/resource snapshots. It separately records 200 new nonnegative texture accounting values, with no differences in the existing values; timing/environment fields are excluded explicitly.

## Cold CPU measurements

| Workload                                                       | Mean ms |
| -------------------------------------------------------------- | ------: |
| Account 1,000 compressed cube chains (13 mips, six layers)     |  0.1864 |
| Snapshot 1,000 recovery stores with aliased views              |  0.2961 |
| Admit/pressure-evict 100 resources with a completed mock fence |  0.0995 |

Measurements reuse prebuilt descriptor/recovery fixtures. The streaming workload constructs a fresh manager, allocates/retires mock payloads and finishes budget trimming each iteration. It does not model real network/decode/upload costs or a real queue's fence latency. Results are observations on this machine, not universal budgets. Warm rendering has no new memory scans, queue scheduling, readbacks or waits. Logical resource counters update only on allocation/retirement, and all preceding particle VFX validation remains passing.

## Reproduce

```sh
pnpm run validate
pnpm run validate:memory
pnpm exec vitest bench --run tests/memory.bench.ts
pnpm run benchmark:gpu --long-animation
```

Saved evidence: [real-GPU memory lifecycle](results/memory-streaming-gpu.json), [cold CPU workloads](results/memory-streaming-cpu.json), [final long-animation matrix](results/memory-streaming-matrix.json), and [regression comparison](results/memory-streaming-comparison.json). Local staged/full logs are in `artifacts/memory-*`. [MEMORY_AND_STREAMING.md](../MEMORY_AND_STREAMING.md) explains configuration, estimates, fallback behavior and ownership limits.
