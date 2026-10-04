# Gameplay hooks, cameras and playable example — 2026-10-04

This implements the second improvement recommendation: game-facing update hooks, a fixed-step simulation API, configurable cameras, keyboard input and a small playable game. The core phase status and optional/default-off Phase 44 policy are preserved.

## Runtime behavior

`Application.onFixedUpdate` dispatches synchronous fixed-step callbacks before a variable `onUpdate`, then animation, world transforms, selected camera pose, palettes, bounds and extraction. Defaults are 1/60 second steps, a 0.25 second frame clamp and eight catch-up steps. Discarded elapsed time is observable; visual interpolation uses the remaining accumulator fraction. Subscription changes allocate on registration/unregistration, while ordinary dispatch reuses callback arrays. Removed callbacks are skipped immediately and additions start next frame. Gameplay exceptions stop RAF and appear in the status output.

`pause`/`stop` cancel RAF and disconnect resize observation. `resume` resets timing debt, resizes/reconnects observation and schedules one RAF; repeated calls do not duplicate loops. Repeated `start` reuses an initialized renderer, concurrent startup shares a promise, and disposal during asynchronous GPU startup destroys the late device. FPS statistics retain actual RAF elapsed time; gameplay and animation receive the bounded delta.

Camera setters configure finite perspective or symmetric orthographic projections, with viewport-driven or authored fixed aspect. The default perspective projection is unchanged. ECS/glTF camera components now connect to application-side `CameraSystem`; explicit selection follows hierarchy/animation transforms, looking down local -Z with local +Y up. Removing/unloading the selected entity returns to manual camera control.

Projection math is connected throughout rendering: actual near/far reach FrameUniforms; orthographic clustered lighting uses linear depth slices and constant tile extents; perspective retains logarithmic slices. CPU/GPU LOD use constant projected radius for orthographic cameras. PBR uses parallel view rays, and shadow receiver corners/cascade splits match the selected projection. Shadow range clamps to camera far and disables below camera near. The frame uniform remains 192 bytes, with projection/clustering flags sharing the existing lighting.z word. No shader variants or GPU buffers were added.

`/?example=collect` starts a six-item collection game using shared cube geometry and three material records. WASD/arrows move, R restarts and C switches cameras. Fixed ticks handle movement/collision, variable updates interpolate/bob/rotate visual poses, and status text changes only when score changes. Focus-scoped keyboard state clears on canvas/window blur or document hiding and preserves browser modifier shortcuts. Restart reuses all entities/materials/resources.

Usage and lifetime details are in README's gameplay/camera sections. Projection setters use defaults for omitted fields; callbacks are synchronous; game/input owners unregister callbacks and dispose input listeners. The example uses finite clipping planes, keyboard controls and simple planar collision rather than adding a physics engine.

## Validation

172 tests across 47 files, strict TypeScript/production build and formatting checks pass. Tests cover fixed-step accumulation/interpolation, bounded catch-up, timing validation, subscription mutation/disposal, very small steps, keyboard edges/focus/modifier shortcuts, movement/collection/reset, standard-Z clipping, aspect resize, projection flags, parented poses, glTF camera instantiation/selection and selected-camera unloading.

`pnpm run validate:game` runs Chrome WebGPU against the production build:

- Custom perspective near/far 2/200 and orthographic near/far 0/40 produce identical full-light-loop and clustered images: zero differing bytes.
- Orthographic four-cascade shadows encode correctly; a near plane beyond shadow distance encodes zero shadow passes.
- Orthographic CPU LOD and GPU indirect LOD images match byte-for-byte.
- Gameplay callbacks execute, pause stops frames, repeated resume works and warm resources remain unchanged.
- Actual keyboard input moves the example player to x=-5, collects one item, switches projection, clears movement on blur and resets score/position through R. Restart preserves resource statistics; the screenshot is saved in `artifacts/collect-game.png`.

The asset lifecycle regression, full production renderer regression and independent GPU benchmark matrix pass with zero GPU/page errors. All 86 counter/resource snapshots match the prior asset-lifecycle matrix exactly. No ordinary-frame GPU waits/readbacks or resource allocations were added.

## Measurements

Baseline was captured before editing; final CPU measurements ran after GPU benchmarks finished:

| Existing CPU workload                   | Before (ms) | After (ms) |
| --------------------------------------- | ----------: | ---------: |
| Extract 10,000 renderables              |    0.907406 |   0.919192 |
| Select 10,000 LOD candidates            |    0.199657 |   0.203120 |
| Compare 10,000 unchanged shadow casters |    0.798303 |   0.802707 |
| Cull 10,000 shadow caster bounds        |    0.320860 |   0.311919 |
| Fit 10,000 caster bounds                |    0.047261 |   0.047754 |

The first LOD implementation measured 0.209034 ms, about 5% above baseline. Hoisting invariant projection reads outside the candidate loop reduces the final result to about 2% above baseline. The other small differences are runtime/measurement variation; this feature work makes no broad speedup claim.

New CPU workload means:

| New workload                                 | Mean (ms) |
| -------------------------------------------- | --------: |
| 1,000 empty gameplay frame dispatches        |  0.009474 |
| 100 callbacks across 100 fixed frames        |  0.066835 |
| 1,000 unchanged ECS camera updates           |  0.042206 |
| 1,000 collection-game fixed steps, six items |  0.029020 |

These isolate CPU functions and exclude RAF, input event delivery, DOM updates, rendering and GPU work. They establish local overhead rather than frame-rate guarantees.

## Reproduction and evidence

```sh
pnpm test
pnpm run build
pnpm run validate:game
pnpm run validate:assets
RENDERER_PREVIEW=1 pnpm run validate:gpu
pnpm run benchmark:gpu
pnpm run benchmark -- tests/extraction.bench.ts tests/lod.bench.ts tests/shadows.bench.ts tests/game-api.bench.ts --outputJson artifacts/game-api-after-cpu.json
pnpm run format:check
pnpm run dev
# Open the server URL with /?example=collect appended.
```

Raw evidence: `benchmarks/results/game-api.json`, `game-api-before-cpu.json`, `game-api-stage1-cpu.json`, `game-api-after-cpu.json`, `game-api-gpu.json`, `game-api-regression.json`, and `game-api-matrix.json`.
