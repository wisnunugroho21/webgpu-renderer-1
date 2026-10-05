# WebGPU renderer

TypeScript/Vite renderer following [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). The initial repository was empty. See [PROGRESS.md](PROGRESS.md) for phase-by-phase validation, benchmark evidence, limitations and optional feature limits.

Use pnpm 12.6.0, pinned in `package.json`. See [installation instructions](https://pnpm.io/installation) if pnpm is not installed.

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Open the displayed localhost URL in a WebGPU-capable browser. The initial scene is an indexed cube. Resize handling uses physical pixel dimensions and device limits; unexpected device loss pauses rendering and automatically rebuilds GPU resources before resuming.

For a complete playable example and a step-by-step game workflow, see [GAME_DEVELOPMENT_GUIDE.md](GAME_DEVELOPMENT_GUIDE.md).

## Code organization

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map, frame sequence, shared GPU layouts, resource ownership, optional feature constraints, and maintenance workflow. Renderer initialization, frame preparation, animation binding setup, worker protocols, input cleanup, post-processing pipelines, asset upload, and GPU validation have separate responsibilities with comments around their invariants. Color setup, custom shader registration, material parameter storage, glTF conversion and demonstration startup now have explicit module boundaries. The architecture guide includes a change-location table and preservation contracts. Public application, renderer and animation APIs retain their existing import paths. See [maintenance validation and benchmark evidence](benchmarks/CODEBASE_MAINTENANCE_REPORT.md).

```sh
pnpm run lint
pnpm run lint:fix
pnpm run format
pnpm run format:check
```

## Particles and visual effects

Enable `app.particles.enabled`, create reusable emitters or call `playEffect` for sparks, smoke, explosions, confetti and shockwaves. Configurable world-space billboards use analytic GPU motion, sorted alpha/additive blending and shared buffers; scene depth, HDR bloom, FXAA and recovery are supported. The feature starts disabled and creates no particle GPU resources before enablement. Try `/?example=particles` (Space: explosion, C: confetti, P: pause, B: bloom). See [PARTICLES.md](PARTICLES.md) for setup, controls, capacity, ownership and limits.

## Validation

```sh
pnpm test
pnpm run build
pnpm run validate:gpu
pnpm run validate:game
pnpm run validate:particles
RENDERER_PREVIEW=1 pnpm run validate:gpu
pnpm run benchmark --outputJson artifacts/benchmarks.json
pnpm run benchmark:gpu
```

The GPU harness requires installed Google Chrome and a usable WebGPU adapter. It starts its own server on isolated port 5187, checks pixel output, camera movement without resource creation, resize, device loss, material modes, offscreen rejection, GLB loading, PBR texture/factor/UV/alpha checks, odd-sized linear/sRGB mipmaps, concurrent texture deduplication, decode failures, and full-image equivalence for 10,000 individual/sorted/instanced cubes. It also compares linear and static BVH rendering. GPU completion waits and mapped readbacks are diagnostic operations; ordinary frames never wait or read back. The independent benchmark matrix uses isolated port 5188 and covers material counts, 64-joint crowds, morph counts, combined deformation and occlusion.

Production preview validation requires `pnpm run build` first. CPU benchmark results are machine-specific and exclude GPU pass timing. Construction cost is excluded from BVH query benchmarks. BVH remains opt-in because it was slower in the fully visible scene despite improving the mostly rejected static benchmark.

Historical and final evidence is saved in `benchmarks/results/`; fresh local results and screenshots go to `artifacts/`. See [benchmarks/REPORT.md](benchmarks/REPORT.md) for the complete A–G matrix and timing limits. Crowd fixtures can be regenerated with `node scripts/create-crowd-fixtures.mjs`.

Quaternion animation now prepares shared normalized LINEAR keyframes once and avoids unnecessary interpolation/normalization work. The 1,000-character crowd's measured animation stage decreased from 21.4 to 11.1 ms. See [animation optimization evidence](benchmarks/ANIMATION_REPORT.md). After building, `pnpm run profile:animation current` captures an animation-only timing summary and Chrome CPU profile on isolated port 5190.

The [second animation optimization round](benchmarks/ANIMATION_ROUND2_REPORT.md) removes temporary matrix views and redundant pose work. Its fresh 1,000-character CPU frame benchmark decreases from 29.0 to 25.9 ms, primarily through faster transform updates.

The [long-clip animation report](benchmarks/ANIMATION_LONG_REPORT.md) adds 1,024-key clips and uniquely phased crowds, plus STEP/cubic/morph/crossfade CPU workloads. Playback bindings reuse key-index hints with bounded neighbor checks and binary-search fallback; this is automatic. The measured 1,000-character long crowd decreases from 11.5 to 10.3 ms for animation and 26.4 to 25.3 ms for the CPU frame. After generating the long fixture and building, use `pnpm run benchmark:gpu --long-animation` or `pnpm run profile:animation current-long --long-animation`.

## Playable example and gameplay loop

Run `pnpm run dev` and open the printed server URL with `/?example=collect` appended (normally `http://127.0.0.1:5173/?example=collect`). Collect six golden cubes using **WASD or arrow keys**. **R** restarts; **C** switches between orthographic and perspective cameras. Click the canvas to focus input. The original cube remains the default route.

The example in `src/examples/collect.ts` uses shared cube geometry/material IDs, focus-scoped keyboard input, fixed simulation for movement/collision, and interpolated render poses. `CollectGame.ts` keeps the gameplay model independent of rendering and input. `KeyboardInput.dispose()` removes its listeners; unregister gameplay callbacks when their owner is destroyed.

```ts
await app.start();
app.simulation.configure({
  stepSeconds: 1 / 60,
  maxFrameSeconds: 0.25,
  maxSteps: 8,
});

const offFixed = app.onFixedUpdate((dt, simulationSeconds) => {
  // Input, movement, collisions and other simulation rules go here.
  // Use app.world transform setters to propagate dirty state.
});
const offUpdate = app.onUpdate((dt, alpha) => {
  // Optional interpolation/HUD/camera preparation once per displayed frame.
  // alpha is the fraction between the previous and current fixed poses.
});

app.pause();
app.resume();
offFixed();
offUpdate();
```

Callbacks are synchronous and run before animation, transforms, camera selection, skeleton palettes, bounds and extraction. Unsubscribing is idempotent. Callbacks added during dispatch start next frame; removing a callback prevents subsequent calls. Catch-up is bounded to avoid a long hidden-tab pause monopolizing the frame; `simulation.droppedSeconds` reports discarded time. Pause/resume clears accumulated debt and the first resumed frame receives zero delta. `stop()` also pauses; repeated `resume()` does not create duplicate RAF loops. Frame errors stop the loop and appear in the status output. RAF FPS/frame-time statistics use actual elapsed time, while animation/gameplay use the clamped delta.

## Cameras

```ts
app.setActiveCamera(null); // use renderer.camera directly
const camera = app.renderer.camera;
camera.setPosition(0, 4, 10);
camera.setTarget(0, 0, 0);
camera.setPerspective({ fovY: Math.PI / 3, near: 0.1, far: 250 });
camera.setOrthographic({ height: 12, near: 0, far: 250 });
```

Projection setters configure a complete projection with defaults for omitted fields: perspective FOV 60 degrees, orthographic height 10, near 0.1, far 100. Distances must be finite; perspective near is positive, orthographic near may be zero. Omitted `aspect` follows viewport resize; a supplied positive aspect stays fixed. Use `setUp` when changing camera orientation. Update pose through setters rather than mutating camera vector arrays directly.

For an ECS camera, add a transform, call `world.cameras.setPerspective(entity, options)` or `setOrthographic(entity, options)`, then `app.setActiveCamera(entity)`. Camera poses follow the world transform after hierarchy updates, looking down local -Z with local +Y as up. Camera scale is removed by the look-at basis. glTF camera nodes now instantiate these components; discover/select them explicitly:

```ts
const nodes = await app.loadAsset("/scene.glb");
const cameraEntity = Array.from(nodes).find((e) => app.world.cameras.has[e]);
if (cameraEntity !== undefined) app.setActiveCamera(cameraEntity);
```

Removing/unloading the selected camera returns to manual mode while retaining its last pose. Clustering uses actual near/far (logarithmic perspective slices, linear orthographic slices); CPU/GPU LOD, PBR view direction and shadow cascades support both projections. Shadow distance is clamped to camera far, and shadows disable when their distance does not reach camera near. The 192-byte frame ABI and existing perspective defaults are preserved. Validation and measurements: [game API report](benchmarks/GAME_API_REPORT.md).

## Runtime API

In the browser console after initialization:

```js
await window.rendererApp.loadAsset("/regression/triangle.glb");
window.rendererApp.renderer.camera.setPosition(0, 0, 5);
window.rendererApp.renderer.visibilityMode = "bvh";
```

The loader uses [glTF Transform core](https://gltf-transform.dev/) for container/accessor decoding and converts the decoded document to engine-owned data. Render passes read `RenderWorld`; shared GPU assets are addressed by numeric mesh/material IDs. Loading adds the selected scene to the world. The synthetic GLB fixture can be regenerated with `node scripts/create-regression-assets.mjs`.

Entity and material capacities are explicit. Entity IDs are monotonic, preventing stale-ID aliasing; exhausted capacity fails rather than allocating GPU resources in the frame loop. BVH-static objects are marked with `RenderFlags.STATIC`; changes invalidate the snapshot hierarchy. Gameplay changes should use transform setters so dirty propagation occurs.

Phases 1–44 and the Definition of Done are validated. Phase 44 advanced geometry is enabled by default on supported adapters and can be disabled. CPU instancing remains the default; GPU visibility, indirect drawing, LOD and temporal reuse are available as measured optional paths.

PBR shading uses shared material records and five glTF texture maps, with sRGB color attachments and linear blending. Textures decode asynchronously; full GPU mip chains, shared samplers and content-based deduplication are prepared during loading. Linear data and sRGB color uses receive separate cached textures.

Animated GLBs register independent controllers in `rendererApp.animations.animators`. Call `play(clipIndex)`, `pause()`, `stop()`, or set `loop`, `speed` and `currentTime`. Morph and four/eight-weight skin deformation run in shared WGSL helpers; frames upload changed palettes/weights and never rewrite vertex buffers. Both influence sets normalize jointly during loading and share the color/depth/shadow path. Bounds use conservative morph extrema and joint boxes before linear/BVH culling.

Runtime layers are optional and ordered. For an asset with multiple clips:

```ts
const animator = app.animations.animators[0]!;
const upperBody = animator.addLayer({
  clip: 1,
  mode: "override",
  time: 0,
  weight: 0.6,
  nodes: [3, 4, 5], // authored glTF node indices, not ECS entity IDs
});
const additive = animator.addLayer({
  clip: 2,
  mode: "additive",
  time: 0,
  referenceTime: 0,
  weight: 0.25,
});
upperBody.speed = 0.8;
additive.weight = 0.5;
// Weight/time edits appear on the next update; evaluate also works while paused.
animator.evaluate();
animator.removeLayer(upperBody);
animator.clearLayers();
```

Layers have independent `time`, `speed`, `loop` and `playing` controls while the controller plays. Controller pause freezes them all; stop rewinds their clocks without changing their local playing flags. A nonlooping base clip ending stops the controller. Each layer owns sample buffers/key hints; references and node masks resolve during setup. Additive motion is relative to its fixed reference pose and never accumulates across frames. Empty/masked channels leave the base/rest pose unchanged; clearing layers restores it. No layers are installed by default.

## Optional environment lighting

Run the material-grid demo at `/?example=lighting`: click the canvas, press **E** to toggle IBL, **B** to toggle the skybox, and use **left/right arrows** to rotate it. Top row is dielectric, bottom is metal; roughness increases left to right. All spheres share geometry.

Create a procedural environment during loading, or supply externally precomputed data:

```ts
import {
  bakeEnvironment,
  panoramaSampler,
} from "./src/rendering/environment/bakeEnvironment";

const environment = bakeEnvironment((direction, rgb) => {
  const sky = Math.max(0, direction[1]!);
  rgb[0] = 0.1 + sky * 0.3;
  rgb[1] = 0.15 + sky * 0.5;
  rgb[2] = 0.2 + sky;
});
await app.renderer.setEnvironment(environment);
app.renderer.environment.intensity = 0.7;
app.renderer.environment.rotationY = Math.PI / 4;
app.renderer.environment.enabled = false; // retain resources for later re-enable
app.renderer.environment.enabled = true;
await app.renderer.setEnvironment(null); // retire textures/uniform buffer safely

// For an already decoded linear RGB panorama:
// const sampler = panoramaSampler(width, height, rgbFloat32Pixels);
// const prefiltered = bakeEnvironment(sampler, { specularSize: 64, samples: 256 });
```

`bakeEnvironment` is cold CPU preprocessing; use it offline/during loading, not in update hooks. Defaults: 32px specular cube, 8px diffuse cube, 32px BRDF LUT, 128 samples. `EnvironmentData` stores six linear HDR RGBA faces in +X/-X/+Y/-Y/+Z/-Z order with rows top-to-bottom. Diffuse is irradiance divided by π; specular needs a complete power-of-two GGX-prefiltered mip chain at roughness mip/(mips−1). The LUT stores Fresnel A/B in RG with X=NdotV, Y=roughness. Ordinary downsampled image mips are insufficient. Input values must be finite/nonnegative and at most 65504; keep source data immutable until installation completes.

One environment is shared across materials. Installation is transactional and serial; failure preserves the previous environment. First installation creates bounded pipeline variants and three filterable rgba16float textures plus a 16-byte uniform. No environment GPU resources are created by default; toggles and parameter changes reuse installed resources. Clearing releases textures/buffer after a cold completion fence; shader/pipeline/sampler caches live until renderer disposal. Frame/deformation ABIs remain unchanged.

HDR/EXR loading and skyboxes are available through the APIs below; glTF environment extensions remain a separate capability. This implementation supplies single-scattering diffuse/specular IBL; enable optional HDR rendering below to preserve bright highlights through tone mapping. Validation, measured overhead and limitations: [scene features report](benchmarks/SCENE_FEATURES_REPORT.md).

Lights use ECS `world.lights.set(entity, properties)` with directional/point/spot types. Directional lights opt into shadows with `castShadow: true`. Configure `renderer.shadows.cascades` (1–4), `shadowDistance` (>0.1–100), `enabled`, or `cacheEnabled`. The shared array supports four shadow lights and rejects overflow. Clustered lighting defaults to automatic selection for many bounded lights; `renderer.clusters.mode` accepts `auto`, `off`, or `on`, with safe overflow fallback.

`app.profiler` exposes fixed CPU stage history and frame totals. `renderer.gpuProfiler.supported` reports timestamp availability. Set `enabled=true` for at most three captured frames, then `enabled=false` and explicitly call `await readSamples()` for pass times. Full capture slots drop further samples until readback; this diagnostic API keeps all readback outside ordinary frames.

`renderer.depthPrepass.enabled` is optional; it helps overdraw/expensive shading but can regress simple scenes. `renderer.hiz.debugEnabled=true` with `debugMip` displays max-depth mips. Hi-Z/occlusion enable their depth prerequisites. `renderer.submissionMode='gpu-indirect'` enables GPU frustum, compaction and indirect arguments when `gpuDraws.supported` is true; set `gpuOcclusion.enabled=true` for current-depth occlusion. CPU instancing remains faster in the initial 10,000-cube benchmark and remains default. GPU-driven visible/instance/triangle counts are -1 in CPU stats; explicit GPU diagnostics provide actual values.

GPU LOD consumes authored compatible mesh groups registered with `renderer.lodGroups`, referenced by `world.meshes.setLOD(entity, group)`. Thresholds use physical projected size and hysteresis. Opt-in `renderer.temporal.enabled` reuses visibility only for exact stable snapshots; camera, viewport, geometry, material and deformation changes invalidate it. Newly added objects receive a conservative visible frame. LOD geometry is excluded from the initial occluder prepass to preserve conservative visibility.

`app.assetLoader` exposes observable loading records through Unloaded/Loading/Decoded/Uploading/Ready/Failed/Cancelled/Unloading states. Concurrent loads share decode/upload work; repeated instantiation shares numeric GPU assets. Payloads of at least 1 MiB decode in a persistent worker with transferable buffers; small payloads use the main thread. Upload tasks yield between primitives. A single large primitive still packs on the main thread.

Asset uploads are transactional: failures or cancellation reclaim earlier meshes, material slots, texture leases, and morph delta ranges. `await app.unloadAsset(url)` removes **all instances created by `app.loadAsset(url)`**, refreshes the render snapshot, waits for submitted GPU work, and releases the cached decoded/GPU asset. Shared textures remain alive for other assets. External entities, hierarchy attachments, LOD groups, streaming fallbacks, or material bindings can veto unloading; detach those consumers first. Unloading an unknown URL is harmless; loading the same URL during unloading rejects.

```ts
const url = "/regression/skinned.glb";
await app.loadAsset(url);
await app.unloadAsset(url);

await app.assetLoader.setCacheBudget({
  maxRecords: 32,
  maxDecodedBytes: 64 * 1024 * 1024,
});
await app.assetLoader.trimCache();
```

The default cache budget is 64 records and 128 MiB of decoded backing buffers, counted once per asset even when views alias. LRU eviction releases unused whole assets. Application instances retain their asset; live/pending assets and the latest load are protected and can exceed the budget. Budget bytes exclude GPU memory and JavaScript metadata. When using `app.assetLoader.load` directly, call `retain(url)` before loading and invoke its returned release function after detaching your consumers. Manually destroying application entities does not release their cache lease; call `unloadAsset(url)` afterward.

`app.cancelAssetLoad(url)` cancels the shared in-flight operation for that URL; all callers receive an `AbortError`. Handle the loading promise's rejection. Fetches receive an abort signal, cancelled worker jobs ignore late replies, and upload cancellation rolls back after the current asynchronous boundary. Synchronous decoding/primitive packing cannot be interrupted midway. `await app.dispose()` cancels pending loads and completes cleanup before disposing the renderer/device.

Legacy scene entity IDs remain monotonic and consume the configured world capacity even after unloading; `loadAssetHandles` reuses retired handle slots. Animation/morph/skeleton registry IDs may be compacted during unloading; retrieve current IDs through ECS stores rather than retaining array indices. Surviving controller objects, morph views and palette offsets remain valid. Details and measurements: [asset lifecycle report](benchmarks/ASSET_LIFECYCLE_REPORT.md).

`renderer.streaming.bindLOD(group, level, key, loadPrimitive)` and `bindMaterial(materialID, key, loadAsset)` retain resident fallbacks while loading. Streamed texture assets contain one material and replace its texture slots while preserving scalar factors. Call `releaseLOD`/`releaseMaterial` to restore fallbacks, then asynchronously `await renderer.streaming.evictUnused(minimumAge)` outside the frame loop. Eviction waits for submitted work and rechecks references; freed shared morph arena ranges become reusable without relocating live assets. Texture slot changes restore UV/normal metadata and invalidate shadow/temporal caches.

Native KTX2 compressed textures support adapter-gated BC, ETC2/EAC and ASTC formats, role-correct linear/sRGB sampling and authored mip chains. Basis Universal ETC1S/UASTC KTX2 textures transcode in a lazily created worker to supported compressed formats, with RGBA fallback on devices without compression. Unsupported native formats/supercompression, malformed blocks and cubemaps/arrays fail explicitly. Ordinary decoded images still receive generated GPU mipmaps.

`renderer.stats` exposes draw/state/visibility, uploads, deformation activity, FPS and frame durations. FPS measures RAF submission cadence; GPU timing requires the explicit profiler. `activeMorphTargets` counts nonzero signed weights, while `morphTargets` counts declared attached targets. The 1,000-character benchmark is CPU-animation-bound and exceeds a 60 FPS frame budget on the tested machine.

Phase 44 cluster culling is enabled by default when supported. Toggle it after initialization:

```js
const geometry = window.rendererApp.renderer.geometryOptimization;
geometry.enabled = false; // Use conventional mesh draws.
if (geometry.supported) geometry.enabled = true; // Re-enable cluster culling.
```

Uploaded static triangle meshes are divided into shared, consecutive 256-triangle clusters. Compute culls conservative transformed cluster bounds and writes indexed indirect color draws. Small meshes, animated meshes, transparency, unsupported adapters, capacity overflow and `gpu-indirect` object submission use the existing draw path. CPU LOD is supported; depth and shadows retain full geometry. This version provides cluster bounds/culling rather than a mesh-shader API or GPU cluster LOD.

GPU resources and large staging storage allocate during renderer initialization on supported adapters and remain resident until renderer disposal, including while disabled. Unsupported adapters default to the conventional path without these allocations. The fixed limit is 65,536 cluster-instance records per frame; overflowing batches fall back intact. `geometryClusterCandidates` counts cluster-instance records; `geometryClusterDraws` counts submitted indirect commands, including zero-instance culled commands. Actual GPU triangle/instance counts remain `-1` in runtime statistics; benchmark diagnostics read them explicitly. GPU profiler pass 10 measures cluster culling. The expanded `pnpm run benchmark:gpu` validates enabled/disabled full images and measures both mostly rejected and fully visible 200,000-triangle workloads.

## Optional HDR and tone mapping

```ts
app.renderer.hdr.enabled = true;
app.renderer.hdr.exposure = 1; // stops: +1 doubles radiance, -1 halves it
app.renderer.hdr.toneMapping = "reinhard"; // default; "clamp" for a linear clamp
```

HDR is disabled by default and allocates no resources until enabled. It renders the full scene, including transparency, into a shared linear `rgba16float` target. Exposure is applied after blending, then Reinhard maps each channel with `x / (1 + x)`. The final sRGB canvas attachment performs display encoding once. Exposure accepts finite values from −16 to +16 stops. This is SDR presentation of HDR lighting; it does not enable an HDR monitor output mode. Reinhard compresses colors per channel and can reduce saturation at high intensity; Optional bloom and automatic exposure are available as described below.

Disabling HDR restores the original direct rendering path; resources remain cached for reuse. Resize replaces the target, and renderer disposal releases it. The target uses 8 bytes per pixel (about 15.8 MiB at 1920×1080), plus one 16-byte uniform and bounded color/presentation pipeline variants. Half-float scene values above 65504 saturate during presentation. Hi-Z debug runs after tone mapping. No ordinary-frame waits, readbacks or resource creation are added.

The lighting demo enables HDR. Click the canvas, press **H** to toggle it and **−/+** to change exposure by half a stop. Run `pnpm run build && pnpm run validate:hdr` for analytic pixel references, transparency, submission modes, animation/IBL integration, resize, lifetime and overhead checks. See [HDR measurements](benchmarks/HDR_REPORT.md).

## Recyclable entity handles

Existing `world.create()` and `app.loadAsset(url)` keep monotonic numeric IDs. Opt into reuse with handles:

```ts
const entity = app.world.createHandle();
const index = app.world.require(entity); // validate immediately before SoA access
app.world.transforms.add(index);
app.world.transforms.setPosition(index, 1, 2, 3);
app.world.destroy(entity);
app.world.resolve(entity); // null: the old identity stays invalid after reuse

const nodes = await app.loadAssetHandles("/character.glb");
// Nodes are immutable handles; all instance slots, including primitives, recycle.
await app.unloadAsset("/character.glb");
```

A handle is scoped to its world and generation. `require` throws for stale/foreign handles; `resolve` returns null, and stale destruction is a no-op. Retain the handle, not its array index. Numeric indices obtained from handles are temporary SoA access addresses and must be resolved again after asynchronous work or destruction. Only slots originally allocated through the handle API recycle, so legacy IDs never alias replacements. Camera selection accepts either identity type. Animation/skeleton bindings and temporal/BVH snapshots validate recycled generations. Entity count remains capacity-bounded; generation exhaustion retires a slot rather than wrapping.

## GPU device recovery

Unexpected device loss automatically pauses the loop, drains pending asset work and recreates the device, renderer, shared meshes/textures, environment and GPU buffers. Entity handles, scene transforms, camera object, materials and animation playback survive. A running loop resumes with a fresh delta-time origin; a paused loop remains paused. Read `app.deviceState` for `ready/lost/recovering/failed/disposed`. Set `app.autoRecoverDevice = false` to opt out; `await app.recoverDevice()` manually rebuilds or retries a failure. Concurrent calls share one operation. Disposal suppresses recovery and waits for any operation already running.

Uploaded meshes retain packed CPU vertices/indices for recovery (`renderer.meshes.recoveryBytes` reports their size). Uploaded texture leases retain source image data; environment data stays available on `renderer.environment.data` and should remain immutable. Custom GPU-only meshes must pass packed canonical-layout recovery arrays as the second argument to `meshes.register(mesh, {vertices, indices})`. Arbitrary manually assigned material bind groups have no CPU provenance and cause an explicit recoverable failure. Reacquire GPU renderer/resources through `app.renderer` after recovery; old GPU objects cannot be used on the replacement device. CPU camera and streaming lease objects remain stable. See [recovery validation](benchmarks/DEVICE_RECOVERY_REPORT.md).

## Environment files, cached bakes and skyboxes

```ts
await app.loadEnvironment("/sky.exr", { specularSize: 32, samples: 128 });
app.renderer.skybox.enabled = true;
app.renderer.hdr.enabled = true;
```

Radiance HDR and OpenEXR decode to top-down linear RGB. The EXR decoder supports its documented compression formats; declared non-Rec.709 primaries are rejected rather than interpreted as sRGB. Negative radiance clamps to zero and values above 65504 saturate for the half-float lighting target. Three.js is used only for dynamically loaded file parsers, not scene or rendering ownership. Unknown/malformed formats reject. Files are limited to 64 MiB and panoramas to 16 million pixels.

`app.environments` caches bakes by content hash and bake options, deduplicates pending work, and evicts LRU entries (default 8 entries/64 MiB). `clear()` prevents pending bakes from repopulating it. `loadEnvironment` accepts an optional AbortSignal after the bake options. Bakes run only during explicit loading, never in gameplay update hooks; choose resolution/sample count accordingly. Returned cached data is immutable by contract. The skybox reuses the environment's sharp specular level and intensity/yaw. It is independent of the lighting enable toggle, renders behind geometry with depth testing, works with perspective/orthographic cameras, and is tone-mapped with the scene. The lighting demo enables it; **B** toggles background visibility. Default renderer skybox stays off.

## Compressed assets and eight-weight skinning

`loadAsset` and `loadAssetHandles` automatically decode `KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `KHR_mesh_quantization` and `KHR_texture_basisu` when declared by a GLB/glTF. Draco/Meshopt work in the existing main-thread or transferable-worker loading path; optional decoder code and WASM download only when needed. Draco may preserve authored quantization error; the renderer does not replace that geometry with a fallback.

Basis ETC1S/UASTC textures retain authored mips and role-correct linear/sRGB sampling. Adapter support selects compressed output; absent compression support or non-block-aligned base dimensions select RGBA. Supported input is straight-alpha 2D, `rd` orientation, `rgba` swizzle, and Rec.709/unspecified primaries. Basis HDR output, cubemaps/arrays and alternative orientations/primaries reject explicitly. Workers belong to the texture manager and terminate during disposal/recovery.

`JOINTS_1`/`WEIGHTS_1` automatically enable eight weights without a new vertex layout or storage binding. Static secondary influences share the existing deformation arena and are uploaded once; animated palettes remain shared. GPU LOD groups require matching four/eight-weight layouts. More than eight influences reject. See [codec and skinning validation](benchmarks/CODECS_REPORT.md).

## Maintenance checks

Run `pnpm run validate` for ESLint, formatting, unit tests, production build and all renderer/asset/game/HDR/recovery/environment/codec GPU checks. It stops at the first failure. Run CPU/GPU benchmarks separately using `pnpm run benchmark` and `pnpm run benchmark:gpu`; add `--long-animation` to the latter for the long-clip crowd matrix. Module ownership and change locations are documented in [the codebase guide](ARCHITECTURE.md).

## Independent scene instances

```ts
const enemy = await app.instantiateAsset("/enemy.glb");
enemy.animator?.play(0);
await enemy.dispose(); // destroys only this instance, including primitive children
```

Instances expose immutable authored-node handles, a stable optional animator, and a `disposed` flag. Disposal is idempotent and releases the instance cache lease without waiting for or destroying shared GPU resources. External children, skeleton joints, animator or morph bindings veto disposal before any mutation; detach them first. Unused registrations are compacted while sibling controllers/palettes remain valid. Assets remain cached until explicit unload or LRU eviction. URL-wide unload and application disposal invalidate all owned instance lifetimes.

## Explicit animation sampling quality

```ts
animator.evaluationInterval = 1 / 30; // opt-in 30 Hz poses; clocks keep advancing
animator.evaluationPhase = characterIndex / characterCount; // stagger work
animator.evaluationInterval = 0; // restore full-rate quality (default)
```

Held poses remain consistent in color/depth/shadows and conservative animated bounds. End and completed fade poses are forced; explicit evaluate/seek/play are immediate. This setting trades temporal smoothness for sampling cost; use full rate for close characters. It does not automatically pause gameplay or infer visibility.

## Render quality controls

```ts
app.gpu.renderScale = 0.75; // 0.25–2; multiplies device pixel ratio, default 1
app.renderer.antialiasing = "fxaa"; // default "none"
```

Render scaling changes physical canvas size while retaining CSS size; dependent depth/HDR/Hi-Z targets resize together. FXAA is optional and shares a linear half-float scene target plus presentation pass with HDR. It does not enable HDR exposure or Reinhard mapping when HDR is disabled. It filters mapped color, includes blended transparency, and performs sRGB encoding once. As a spatial filter it can soften fine detail; no temporal history/motion vectors are required. First enable prepares bounded resources; warm frames and toggles reuse them. Scale and anti-aliasing survive device recovery. `pnpm run validate:quality` checks scale, restoration, image changes, submission modes, depth/HDR, stable warm resources, recovery and cleanup, and records diagnostic completion timings.

## Gameplay animation controls

```ts
import { AnimationStateMachine } from "./src/animation/AnimationStateMachine";
import { RootMotionSampler } from "./src/animation/RootMotionSampler";

animator.setEvents(0, [{ time: 0.2, name: "footstep" }]);
const offEvent = animator.onEvent((marker, clip, direction) => {
  // Play audio or schedule a game action; marker objects are immutable/shared.
});
const states = new AnimationStateMachine(animator, {
  idle: { clip: 0 },
  run: { clip: 1, fadeSeconds: 0.2 },
});
states.transition("run"); // repeated requests do not restart a fade

// A single-clip authoritative root-motion controller:
animator.updateMode = "manual";
animator.setInPlaceRoot(authoredRootNode);
const root = new RootMotionSampler(animator.clips[0]!, authoredRootNode);
const delta = new Float32Array(7); // xyz translation, xyzw rotation
let clock = 0;
const offFixed = app.onFixedUpdate((dt) => {
  const previous = clock;
  clock += dt * animator.speed;
  root.delta(previous, clock, delta, animator.loop);
  // Apply delta in actor-local space, with collision handling owned by gameplay.
  animator.update(dt); // automatic animation stage skips manual controllers
});
// On cleanup: offFixed(); offEvent();
```

RootMotionSampler is pure and does not move ECS entities itself. It normalizes away the clip's initial rigid pose, ignores scale, and composes rotating loop displacement. For transitions, gameplay chooses/mixes source and target track deltas and resets its unwrapped clock when switching clips; visual crossfades remain available independently. Marker crossing windows exclude the starting endpoint and include the destination; seeks/evaluate do not emit events, and paused playback does not advance. Markers at zero fire when crossing a loop seam, not automatically on play. Only the target clip emits during fades. Excessive event crossings reject explicitly; ordinary callbacks allocate no marker/event objects.

## Picking and spatial queries

```ts
const handle = app.pick(pointerEvent.clientX, pointerEvent.clientY);
// Returns the nearest renderable primitive's safe identity, or null.

import { Ray } from "./src/spatial/Ray";
import { RayHit } from "./src/spatial/SpatialQueries";
const ray = new Ray();
const hit = new RayHit();
ray.set([0, 2, 10], [0, 0, -1]);
if (app.spatial.raycast(ray, hit, 100)) {
  // hit.entityId/generation, distance, world-space point, snapshot objectIndex
}
const output = new Uint32Array(app.renderWorld.capacity);
const count = app.spatial.queryAABB([-5, -5, -5], [5, 5, 5], output);
// output[0..count) contains snapshot object indices.
```

Queries use the latest extracted snapshot and include offscreen objects. Ray hits and overlaps are conservative AABB candidates, not exact mesh intersections or physics contacts. Reuse Ray/RayHit/output scratch for frequent queries, and validate saved identities against current world generations. CSS picking accounts for render scale and both camera projections.

## Responsive loading and offline environment bakes

Large assets prepare canonical vertices, indices, influence streams, morph extrema and cluster metadata in the existing decode worker. Prepared arrays transfer without copies. Uploads publish only after completion, yield between vertex/index writes of at most 1 MiB, and roll back cancellation/device failure. Decoder metrics include worker preparation time and prepared mesh count. Small input assets/main-thread fallback still prepare synchronously; deformation-arena append is also cold work.

```sh
pnpm run bake:environment public/sky.hdr public/sky.envbin --specular-size 32 --samples 128
```

```ts
await app.loadEnvironment("/sky.envbin");
// Or parse/bake an HDR/EXR file through the lazy environment worker:
await app.loadEnvironment("/sky.exr", { specularSize: 32, samples: 128 });
```

Archives fix their bake quality/dimensions at creation; runtime bake options do not change precomputed data. Files contain validated linear float32 faces/mips/LUT data with version/length checks. Browser preparation uses a lazily created reusable worker (`app.environments.preparation.enabled = false` opts into the main-thread path). Clearing the environment cache terminates pending worker preparation. No parsing, baking or asset preparation occurs in ordinary rendering frames.

### Optional HDR post effects

```ts
app.renderer.hdr.enabled = true;
app.renderer.hdr.toneMapping = "filmic"; // also reinhard / clamp
app.renderer.hdr.bloomThreshold = 1;
app.renderer.hdr.bloomStrength = 0.3;
app.renderer.hdr.exposureKey = 0.18;
app.renderer.hdr.adaptationSpeed = 3;
app.renderer.hdr.autoExposure = true;
```

Bloom reduces bright radiance into a bounded six-level half-float pyramid. Automatic exposure reduces log luminance to one GPU texel and adapts a persistent GPU gain toward the exposure key. Application supplies frame delta automatically; custom render loops set `hdr.frameDeltaSeconds`. Manual exposure stops multiply the automatic gain. Adaptation speed zero freezes gain; disabling automatic exposure returns to manual gain. Device recovery restarts adaptation from gain one. Filmic is an approximate rational curve, not a reference ACES color pipeline. All effects default off, run after transparent blending and before one sRGB encoding, and perform no runtime readback. FXAA can be combined with these effects. This remains SDR canvas presentation.

### Pointer, touch, gamepad and camera controls

Import helpers from `src/input/PointerInput`, `TouchJoystick`, `GamepadInput`, and `src/camera/OrbitCameraController` / `ThirdPersonCameraController`. They are optional game-layer owners; rendering passes never read input.

```ts
app.setActiveCamera(null); // let the controller own the renderer camera
app.canvas.tabIndex = 0;
const pointer = new PointerInput(app.canvas);
const pad = new GamepadInput(app.canvas);
const orbit = new OrbitCameraController(app.renderer.camera, {
  minDistance: 1,
  maxDistance: 40,
});
const delta = new Float32Array(3);
const offFixed = app.onFixedUpdate((dt) => {
  pad.update(); // focus-scoped, standard mapping only
  // pad.axes[0..1]: left stick; [2..3]: right stick
  // movePlayer(dt, pad.axes[0], pad.axes[1]);
  if (pad.consumePressed(0)) jump();
});
const offFrame = app.onUpdate(() => {
  pointer.consume(delta); // consume only once, including completed drags
  orbit.update(delta[0], delta[1], delta[2]);
});
// On scene teardown:
offFixed();
offFrame();
pointer.dispose();
pad.dispose();
```

`PointerInput` captures a primary mouse, pen or touch drag and accumulates CSS-pixel drag/wheel deltas in caller-owned storage. Capture/focus loss and hidden documents clear held state; disposal restores the previous CSS touch action. Mount `TouchJoystick` on a separate DOM element (for example a thumb pad) to move with one touch while another touch drags the camera. Its persistent two-float `axes` are radial-clamped to unit length and reset on release/cancel. It accepts touch pointers only. The game owns that element and removes it after disposing the joystick.

`GamepadInput` selects the first connected standard-mapping pad. Its radial deadzone defaults to 0.15, edges persist until consumed, and disconnect/focus loss clears state. Pass no target for explicitly global polling, or supply a provider for deterministic simulation/tests. Call `update()` once per fixed tick; `dispose()` disables future polling. Controller/gamepad storage is reused; browser polling costs are platform-dependent.

`OrbitCameraController` uses Y-up orientation, bounded distance and pole-safe pitch, and preserves perspective/orthographic projection. Call `syncFromCamera()` after external teleports. For a follow camera, instantiate `ThirdPersonCameraController(camera, { height: 1, followSpeed: 8 })`, then call `follow(dt, playerPosition, headingRadians, dragX, dragY, wheel, snap)` in the variable update. The position is world-space; heading rotates the orbit offset about world Y. Set `snap=true` for spawning/teleports. Smoothing is time-based and target positions can be interpolated from fixed simulation. Camera collision and character movement remain gameplay responsibilities. Use only one active camera controller at a time.

Try `?example=collect`: WASD/arrows, touch stick or gamepad move; R/gamepad A restarts; C/Y switches projection; F/X toggles following; drag orbits and wheel zooms. The thumb pad appears on coarse-pointer devices. The example disposes inputs and update subscriptions together.

## ESLint and Prettier

`pnpm install --frozen-lockfile` installs the locked development tools. Run `pnpm run lint` to check TypeScript source/tests and JavaScript tooling with recommended ESLint rules; `pnpm run lint:fix` applies available fixes. Warnings fail the lint command. `pnpm run format` formats supported files with the existing Prettier configuration and then formats WGSL with the token-preserving shader formatter. `pnpm run format:check` checks both without modifying files. Generated output, assets, dependency directories and benchmark result files are excluded. ESLint uses `eslint-config-prettier` to avoid conflicting formatting rules.

Configuration lives in `eslint.config.js`, `.prettierrc.json` and `.prettierignore`. The complete validation command runs lint first. VS Code extension recommendations and workspace settings enable Prettier format-on-save and explicit ESLint fixes. WGSL remains handled by the dedicated command-line formatter.

The build compiler remains TypeScript 7.0.2. The current typescript-eslint parser requires TypeScript below 6.1, so `tools/lint` is a separate workspace package using TypeScript 6.0.3. Both packages are installed by the pnpm workspace with one root lockfile; ESLint imports the workspace parser bridge. This avoids unsupported peer dependencies or downgrading the build compiler, without an installation hook. Lint uses syntax-based recommended rules; strict type checking stays in `pnpm run build`.

## Package manager

Use pnpm 12.6.0, pinned in `package.json`. Install pnpm using the [official installation instructions](https://pnpm.io/installation), then run `pnpm install --frozen-lockfile` from the repository root. The workspace installs the renderer and `tools/lint` together; `pnpm-lock.yaml` is the shared committed lockfile. Use `pnpm add` / `pnpm add -D` for dependencies and `pnpm --filter webgpu-renderer-lint add` for linter-toolchain dependencies. Do not run npm install or create nested npm lockfiles.

Run scripts with `pnpm run <name>` or execute installed tools with `pnpm exec <tool>`. Script arguments follow the script name directly, for example `pnpm run benchmark:gpu --long-animation`. `pnpm run validate` invokes its child checks through pnpm. The root build compiler remains TypeScript 7 and the lint workspace retains TypeScript 6; peer resolution is isolated between them.

## Custom shader materials

Register surface WGSL with `await app.registerMaterialShader({ name, source })`, then create materials with `shaderId` and up to 16 `shaderParameters`. The required `shadeMaterial(MaterialSurface, MaterialShaderParameters) -> vec3<f32>` function returns linear RGB while shared geometry, alpha coverage, instancing, depth/shadows, HDR and recovery remain renderer-owned. See [CUSTOM_MATERIALS.md](CUSTOM_MATERIALS.md) for the complete contract and examples. Try `/?example=shaders`; run `pnpm run validate:materials` for correctness, lifetime and diagnostic benchmarks.
