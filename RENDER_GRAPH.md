# Resource lifetimes and transient targets

Render graphs compile dependency order, record each resource version's inclusive first/last use, and optionally assign transient texture versions to compatible physical slots. `Resources.targets` owns a device-local target pool used by graph-owned targets and HDR/post-effect resize targets. Compilation, acquisition, view/group preparation and retirement occur at cold configuration boundaries; ordinary graph execution only calls retained pass callbacks.

## Inspect the existing renderer graph

```ts
const graph = app.renderer.graph;
console.table(Array.from(graph.lifetimes.values()));
console.log(graph.order.map((pass) => pass.name));
console.log(graph.targets); // slots, logicalBytes, physicalBytes, peakLiveBytes
console.log(app.renderer.resources.targets.stats);
```

Intervals refer to the **compiled schedule**, rather than pass registration order. A writer establishes first use; every consumer extends last use. Imported resources start at −1 and remain externally owned. Resources used by the same pass overlap, so an input cannot alias its output through the allocator. Exported transient targets remain live through the end of the graph. Their contents are valid until the next execution or target-set disposal, not indefinitely across frames.

The renderer graph's existing buffers, cached shadow maps, depth/Hi-Z, swapchain and scene-color versions remain explicitly owned by their established managers. Lifetime diagnostics include their logical versions, but these resources are not automatically reassigned. Cached maps, temporal history, external outputs needed across frames and persistent exposure state must stay externally owned/imported. Only textures explicitly declared transient participate in graph allocation. Existing bloom mip chains and differently sized/formatted luminance levels are not assumed to be mutually aliasable.

## Declare and prepare graph targets

Use a separate graph for custom passes, before compilation:

```ts
import { RenderGraph } from "./rendering/graph/RenderGraph";

const graph = new RenderGraph();
graph.transient("scratch", {
  descriptor: {
    label: "My scratch target",
    size: [width, height],
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  },
  initialization: "clear",
});

// Register producer/consumer passes with graph.add(...).
// In their callbacks, use retained views/groups prepared below.
graph.compile();
const targets = graph.prepareTargets(app.renderer.resources.targets);
const scratchView = targets.get("scratch").view;
// Prepare pipelines/bind groups that reference scratchView once here.
// Execute the graph each frame with your encoder; then submit normally.
// After its final submission and before replacing the configuration:
targets.dispose();
```

The example is an integration skeleton: add a real producer writing `scratch` and any consumers reading it before compilation. A declaration without a producer is rejected. Graph dependency checks still reject unknown reads, multiple writers, feedback and cycles. The first writer must actually clear or fully overwrite all readable subresources; `initialization` accepts `clear` or `full-write`, and rejects load-first use. This is a caller contract, not automatic command instrumentation. Pool contents are undefined on acquisition, including reused targets.

The planner sorts targets by first use and reuses an exact-compatible slot only when its previous last use is **strictly earlier**. Compatibility includes normalized width/height/depth, dimension, format, mip levels, sample count, usage and sorted view formats. Labels and omitted defaults do not affect compatibility. Usage unions, cross-format heap aliases, buffer aliases, automatic pass pruning and synchronization across queues are not implemented. Non-transient resources never join a slot implicitly. Descriptor/pass inputs are copied during authoring; compiled schedules and public assignments are immutable snapshots.

`targets.get(name)` exposes the retained texture/default view. The target set retains physical lease ownership, releasing each slot once even if several logical names alias it. Do not independently destroy returned textures. Call `targets.dispose()` when replacing/unloading the graph; failed preparation rolls back already acquired leases. Create a new graph/target set for changed descriptors rather than mutating a compiled graph. Lookup is allocation-free, but capturing views/groups during setup keeps hot callbacks simpler.

## Pool ownership and resize reuse

`app.renderer.resources.targets.acquire(descriptor)` also supports cold owners outside a graph. It returns one lease with `texture`, a retained default `view`, and idempotent `release()`. Active leases are exclusive; release moves an entry into quarantine. An asynchronous queue-completion fence makes it eligible for idle reuse only after already-submitted GPU work completes. Failed fences destroy the retired entry; device teardown destroys active, retired and idle ownership, and late callbacks cannot resurrect it.

Make configuration changes between submissions. **Do not retain unsubmitted command buffers referencing a released target**, and do not access a released lease again. A completion fence cannot cover command buffers submitted later by the caller. The same device/queue owns this pool; cross-device targets are never shared. Persistent graph target sets retain their leases across frames and need no per-frame fence.

HDR scene textures, bloom pyramids and luminance targets borrow pool leases on enable/resize. Resizing back to previously completed compatible sizes can reuse physical textures/default views. Bind groups referencing resized inputs are rebuilt at that cold boundary. Feature toggles retain their warmed active resources as before. Scene depth/Hi-Z and exposure history retain their existing ownership and behavior.

Idle retention is bounded to **64 MiB and 32 physical textures** in the default Resources pool. Oversized/old idle entries are evicted. Active and quarantined allocations remain tracked but are not evicted for reuse; these may exceed idle limits during rapid resize/GPU backlog. `pool.stats` reports hits, misses, active/retired/idle bytes and evictions. All of these allocations also appear in ordinary texture/render-target memory accounting; pooling does not hide retained VRAM payload. `pool.clearIdle()` explicitly frees completed idle cache memory without disturbing active/quarantined work. Custom pool constructors accept separate byte/count bounds, including zero to disable retention.

`await pool.settle()` is for explicit shutdown, maintenance or diagnostics. Never call it from the normal frame loop. The renderer requests retirement fences only when targets are released during cold lifecycle work, and never blocks frame encoding waiting for them. GPU driver overhead and still-held command-buffer references are outside logical payload accounting.

## Validation and benchmarks

After building, run `pnpm validate:graph` for real GPU alias/reference images, completed-target reuse, resize-back reuse, warm resource counters and complete disposal. `pnpm validate` includes this gate. Unit coverage checks inclusive overlaps, exports, exact compatibility, copied authoring inputs, invalid declarations, partial preparation rollback, idempotent release, rejected fences, retention bounds and disposed callbacks.

See [benchmarks/RENDER_GRAPH_REPORT.md](benchmarks/RENDER_GRAPH_REPORT.md) for CPU compilation/dispatch costs, physical memory savings, GPU measurements and the full production comparison.

Custom graphs must reacquire their target set and rebuild bindings against recovered Resources after device loss. Compiled CPU descriptors can be reused when dimensions stay the same; old GPU views and leases cannot. Renderer-owned HDR/post targets already recover through the existing settings replay.
