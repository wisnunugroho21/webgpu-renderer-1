# Memory accounting and budgeted streaming

Call `app.memory` after startup at a loading screen, streaming maintenance boundary, or diagnostic action. This cold snapshot reports current GPU storage and distinct retained CPU backing stores. It does not run from the frame loop.

```ts
const memory = app.memory;
console.table(memory);
// gpuBytes, bufferBytes, textureBytes, mipBytes, compressedBytes,
// renderTargetBytes, recoveryBytes, decodedCacheBytes, environmentCacheBytes
```

`app.renderer.resources.stats` updates GPU byte counters at creation/destruction. Texture descriptors account for every mip, constant array/cube layers, shrinking 3D slices, MSAA samples and complete compressed blocks, including small tail mips. `textureMipBytes` counts levels beyond mip zero. `compressedTextureBytes` and `renderTargetBytes` are subsets of `textureBytes`, rather than extra allocations; `gpuBytes = bufferBytes + textureBytes`. Mip-generation attachment usage does not turn material textures into render targets. Resources.textures.create optionally accepts `"asset"` or `"render-target"` to classify unusual descriptors explicitly; the default identifies attachment or storage-output textures without COPY_DST as targets, including Hi-Z and post-processing pyramids.

These are logical payload estimates, not a measurement of driver VRAM. They exclude implementation alignment, allocator/driver overhead, pipelines, shader binaries and the browser-owned swapchain. Depth24plus is estimated at four bytes/texel and combined depth/stencil at eight; actual depth storage is implementation-dependent under the [WebGPU specification](https://gpuweb.github.io/gpuweb/#texture-format-caps). Buffer accounting follows owned GPUBuffer sizes. Shared material cache textures count once; destroying an unknown/already retired texture changes nothing. Resize, replacement, eviction and disposal subtract the original owned allocation.

`recoveryBytes` counts whole distinct ArrayBuffer backing stores retained by mesh/deformation definitions, material texture runtime assets, material descriptions, environment data and particle/curve/trail/atlas provenance. `app.memory` additionally includes decoded asset and environment caches; shared views and the same runtime definition retained by two owners count once. GPU geometry packing can retain a different backing store from decoded attributes; both count when both remain alive. Object/string overhead, gameplay simulation arrays, in-flight fetch/decode/staging temporaries and externally owned custom resources are excluded. The renderer snapshot covers its own recovery sources; the application snapshot includes broader cache ownership. Read snapshots sparingly: metadata walking costs CPU time and temporary collections.

## Enable budgeted replacement streaming

Budgets are opt-in. Existing authored LOD/material streaming and age-based eviction remain available. Set byte ceilings and concurrency after `await app.start()`:

```ts
const baseline = app.memory;
app.setStreamingBudget({
  maxGPUBytes: baseline.gpuBytes + 64 * 1024 * 1024,
  maxRecoveryBytes: baseline.recoveryBytes + 64 * 1024 * 1024,
  maxConcurrent: 2,
  maxQueued: 128,
});

await app.renderer.streaming.bindLOD(groupId, 1, "hero-low", loadLowPrimitive, {
  priority: 10,
  estimate: {
    gpuBytes: packedGeometryBytes,
    recoveryBytes: retainedGeometryBytes,
  },
});
await app.renderer.streaming.bindMaterial(
  materialId,
  "hero-detail",
  loadTextureAsset,
  {
    priority: 5,
    estimate: {
      gpuBytes: textureMipChainBytes,
      recoveryBytes: encodedAssetBytes,
    },
  },
);
```

Estimates describe **additional** peak payload headroom, including all requested texture mips/layers and any retained geometry/asset arrays. Choose them from an authored manifest, not file size alone: PNG/JPEG size is not GPU texture size. `textureMemory(descriptor)` from `src/gpu/TextureMemory.ts` computes logical GPU texture costs without allocation. Shared-cache hits may allocate less than their estimate; conservative estimates can therefore refuse a request that would have deduplicated. Default omitted estimates are zero; use accurate estimates to avoid transient overshoot and expensive rollback.

Fixed renderer buffers, render targets, resident assets and application retained caches are included in these limits. Higher priorities start first among queued requests, with FIFO order at equal priority. Active requests are not preempted. Max concurrent loads is [1, 16], max queued requests [1, 1,024], default 2/256. Byte limits default to Infinity, or may be any nonnegative safe integer. Lowering limits keeps bound resources intact even if they already exceed the new ceiling. The queue limit counts waiting jobs; active jobs have a separate concurrency limit. A deduplicated key shares its original load/priority and ownership, rather than starting another transaction.

Before a new load starts, admission checks current payload plus in-flight reservations. Under pressure it fences submitted GPU work on this cold path and evicts oldest unleased residents, rechecking external render/LOD/material references before destruction. Reacquisition while asynchronous destruction runs is rejected, so a retiring GPU object cannot escape through a new lease. Failed retirement stays tracked for retry. Concurrent admissions and age/pressure maintenance share a serialized barrier. Reservations are conservative: allocations already materialized by another active upload may also remain reserved until it finishes.

If pinned resources leave insufficient headroom, the queued request rejects with `StreamBudgetError` before loading. The bound resident fallback stays available. After loading, measured GPU/recovery totals must fit before publication; an underestimated replacement is fenced and destroyed instead of bound. Failed rollback remains tracked for later cleanup rather than silently losing ownership. An inaccurate estimate may temporarily exceed a budget during upload: these limits govern streamed publication and tracked resident payload, not a hard physical allocation ceiling. Requests already started continue to settle when their slot is detached; queued loading is not a network abort API.

## Release and maintain

```ts
app.renderer.streaming.releaseLOD(groupId, 1);
app.renderer.streaming.releaseMaterial(materialId);
await app.renderer.streaming.trimBudget(); // Pressure-based, regardless of resident age.
await app.renderer.streaming.evictUnused(60); // Existing age-based policy.
const diagnostics = app.renderer.streaming.resources.diagnostics;
// budget, active, queued, reserved, memory
```

Call maintenance asynchronously at explicit streaming/scene boundaries. Do not await it inside ordinary frame rendering. Bound slots own leases and restore their resident fallback on release. Other external consumers can veto eviction; lowering a budget never detaches them automatically. Handle `StreamBudgetError` in your loading UI and keep the fallback, defer detail, or request a smaller authored replacement. Budgets do not automatically choose mip subsets, replace high-quality bound assets, or resize render targets. This path streams whole authored LOD/material replacements.

Ordinary `app.loadAsset`/`instantiateAsset`, environment installation, HDR enablement, canvas resize and custom GPU allocation retain their existing transactional behavior; they are accounted but are not routed through replacement-stream admission. Keep decoded URL-cache limits with `await app.assetLoader.setCacheBudget({ maxRecords: 64, maxDecodedBytes: 128 * 1024 * 1024 })`, dispose scene leases and unload unused assets independently. Those pinned/baseline allocations can refuse later streaming requests until enough memory is released. Keep both CPU and GPU totals in view.

Budgets, leases, retained definitions and custom application accounting survive device recovery. Renderer streaming resolves the current resource owners before admitting later work. Standalone renderers can use `renderer.streaming.setBudget(...)` against renderer-only memory, or set a broader callback with `setMemoryProvider`. Generic `Streaming<T>` accepts a memory provider as its third constructor argument; finite byte limits require it. Providers must report nonnegative safe integers and exclude no owned payload you want budgeted. Concurrency-only configuration works without a provider. Snapshot methods allocate no GPU resources and submit no work.

```sh
pnpm run validate:memory
pnpm exec vitest bench --run tests/memory.bench.ts
pnpm run validate
```

The GPU gate covers authored texture mip accounting, retained provenance, pre-load denial, pressure replacement, bound-resource protection, underestimated-load rollback, HDR/resize targets, compressed small mips when BC is supported, recovery and zero-byte teardown. Unit tests cover non-square chains, array/3D/MSAA layouts, alias deduplication, priority/capacity, invalid controls, retryable cleanup and asynchronous retirement. See [benchmark evidence](benchmarks/MEMORY_STREAMING_REPORT.md).
