# Creating a game with this renderer

This project provides rendering, an entity world, scene loading, animation, cameras, input helpers and a simulation loop. Your game supplies rules, authoritative movement, collision responses, progression, UI and audio. Start with `Application`; it already owns the browser frame loop and GPU lifetime.

## 1. Run the project

Use pnpm 12.6.0, as pinned in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Open the localhost URL printed by Vite in a WebGPU-capable browser. WebGPU requires a secure context; localhost is suitable for development. Run `pnpm run build` and `pnpm run preview` to try a production build.

The existing entry is [src/main.ts](src/main.ts). [index.html](index.html) provides `canvas#viewport` and `output#status`. Try `/?example=collect` for the complete collection game, or `/?example=lighting` for a lighting scene. The collection example supports keyboard, gamepad, touch, orbit and follow controls. Read [collect.ts](src/examples/collect.ts) and [CollectGame.ts](src/examples/CollectGame.ts) together: the former connects rendering/input; the latter owns simulation rules.

## 2. Understand the responsibilities

| Owner                      | What your game does with it                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `app.world`                | Creates entities and changes transform, mesh, bounds, light and camera components. |
| `app.onFixedUpdate`        | Advances authoritative gameplay by a fixed duration in seconds.                    |
| `app.onUpdate`             | Interpolates visuals and updates frame-dependent presentation before extraction.   |
| `app.materials`            | Creates shared PBR material descriptions.                                          |
| `app.renderer`             | Configures rendering and the direct camera; it consumes an extracted snapshot.     |
| `app.instantiateAsset`     | Loads a scene with independent entity lifetime and shared underlying assets.       |
| `app.pick` / `app.spatial` | Queries the latest extracted scene bounds.                                         |

Each frame, the application advances simulation, evaluates animation and transforms, updates skeletons and animated bounds, extracts `RenderWorld`, prepares visibility/batches and encodes GPU passes. Rendering passes operate on the snapshot rather than querying gameplay entities. See [ARCHITECTURE.md](ARCHITECTURE.md) for the detailed sequence.

Do not add another `requestAnimationFrame` loop to render the same application. Register hooks on the existing loop. Use component setters so dirty/version tracking can detect changes; directly writing component arrays can leave transforms, bounds or GPU uploads stale.

## 3. Build a small playable game

Replace `src/main.ts` with this example. It uses the existing HTML/CSS, bootstrap cube and default directional light. Click the canvas, move with WASD and collect the three golden cubes. Restart with R.

The sample uses generational handles for newly created entities, fixed-step collision and interpolated presentation. The built-in cube extends from -1 to +1 on each local axis, so scaling it by 0.3 makes it 0.6 units wide.

```ts
import { Application } from "./app/Application";
import type { EntityHandle } from "./ecs/Entity";
import { KeyboardInput } from "./input/KeyboardInput";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const app = new Application(canvas, status);
await app.start(); // GPU resources are usable after startup resolves.
const world = app.world;
const player = app.sceneEntity;
const gold = app.materials.create({
  baseColor: [1, 0.65, 0.05, 1],
  roughness: 0.35,
});
const floorMaterial = app.materials.create({
  baseColor: [0.08, 0.12, 0.18, 1],
  roughness: 1,
});

/** Allocates an independently owned cube while sharing mesh zero. */
function cube(
  material: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
): EntityHandle {
  const handle = world.createHandle();
  const id = world.require(handle);
  world.transforms.add(id);
  world.transforms.setPosition(id, x, y, z);
  world.transforms.setScale(id, sx, sy, sz);
  world.meshes.set(id, 0, material);
  world.bounds.setSphere(id, 0, 0, 0, Math.sqrt(3));
  return handle;
}

world.transforms.setScale(player, 0.3, 0.3, 0.3);
const floor = cube(floorMaterial, 0, -0.15, 0, 6, 0.1, 6);
const itemX = [2, -2, 0];
const itemZ = [0, 0, -3];
const items: EntityHandle[] = [];
for (let i = 0; i < itemX.length; i++)
  items.push(cube(gold, itemX[i]!, 0.4, itemZ[i]!, 0.25, 0.25, 0.25));
const collected = new Uint8Array(items.length);
let x = 0,
  z = 0,
  previousX = 0,
  previousZ = 0,
  score = 0;

app.renderer.camera.setPosition(0, 12, 9);
app.renderer.camera.setTarget(0, 0, 0);
app.renderer.camera.setOrthographic({ height: 14, near: 0.1, far: 50 });
app.simulation.configure({
  stepSeconds: 1 / 60,
  maxFrameSeconds: 0.25,
  maxSteps: 8,
});
canvas.tabIndex = 0;
const input = new KeyboardInput(canvas, [
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyR",
]);
/** Gives scoped keyboard input to the game after a pointer interaction. */
function focus(): void {
  canvas.focus();
}
canvas.addEventListener("pointerdown", focus);

/** Updates UI only on score/reset changes, avoiding per-frame DOM work. */
function showScore(): void {
  status.textContent = `Collected ${score}/${items.length} · WASD: move · R: restart`;
}
/** Restores collectible mesh components and authoritative player state. */
function reset(): void {
  x = z = previousX = previousZ = score = 0;
  collected.fill(0);
  for (const handle of items) world.meshes.set(world.require(handle), 0, gold);
  showScore();
}

const offFixed = app.onFixedUpdate((dt) => {
  // Input and collision use completed simulation ticks, not interpolated visuals.
  if (input.consumePressed("KeyR")) reset();
  previousX = x;
  previousZ = z;
  const dx = Number(input.isDown("KeyD")) - Number(input.isDown("KeyA"));
  const dz = Number(input.isDown("KeyS")) - Number(input.isDown("KeyW"));
  const movement = (3 * dt) / Math.max(1, Math.hypot(dx, dz));
  x = Math.max(-5, Math.min(5, x + dx * movement));
  z = Math.max(-5, Math.min(5, z + dz * movement));
  for (let i = 0; i < items.length; i++) {
    if (
      !collected[i] &&
      (x - itemX[i]!) ** 2 + (z - itemZ[i]!) ** 2 < 0.65 ** 2
    ) {
      collected[i] = 1;
      world.meshes.remove(world.require(items[i]!));
      score++;
      showScore();
    }
  }
});
const offFrame = app.onUpdate((_dt, alpha) => {
  // Render between the previous and current fixed states; collision keeps using x/z.
  world.transforms.setPosition(
    player,
    previousX + (x - previousX) * alpha,
    0.35,
    previousZ + (z - previousZ) * alpha,
  );
});

let disposed = false;
/** Stops game hooks/input, despawns owned entities and releases application resources. */
async function disposeGame(): Promise<void> {
  if (disposed) return;
  disposed = true;
  offFixed();
  offFrame();
  input.dispose();
  canvas.removeEventListener("pointerdown", focus);
  for (const handle of items) world.destroy(handle);
  world.destroy(floor);
  await app.dispose();
}
window.addEventListener(
  "pagehide",
  () => {
    // Begin teardown when navigating away; browsers need not wait for asynchronous completion.
    void disposeGame();
  },
  { once: true },
);
showScore();
```

This deliberately small game uses distance checks rather than a physics engine. It hides collected objects by removing their mesh component and reuses them on reset. A larger game should split simulation, scene construction, input and UI into modules, following the existing collection example.

## 4. Create and manage entities safely

A renderable entity needs a transform, a mesh and local bounds. Mesh/material IDs reference shared resources; an entity does not own a separate GPU buffer just because it references a mesh.

Use `world.createHandle()` for entities whose slots may be recycled. Store the returned `{ index, generation }`; call `world.require(handle)` immediately before component access. It throws if the handle is stale. `world.resolve(handle)` returns `null` for a stale handle, which is useful for selections or asynchronous callbacks. `world.destroy(handle)` removes the entity's components and invalidates its identity.

The compatibility API `world.create()` returns a numeric ID. These allocations do not participate in safe slot recycling. A bare number cannot distinguish a deleted entity from a later occupant of a recycled slot. Keep handles in long-lived game state and use numeric indices only for immediate component operations.

Call `transforms.add(id)` before setting the pose. Positions and bounds use your chosen world units; quaternion rotations use `[x, y, z, w]`, and angles in camera/animation helpers use radians. Local bounds must contain the mesh before its entity transform is applied. The application computes world bounds, including animated bounds where supported. Wrong or missing bounds cause culling and picking failures.

For static scenery, use `RenderFlags.STATIC` from [RenderFlags.ts](src/rendering/RenderFlags.ts) in the fourth argument to `world.meshes.set`. Mark only objects that remain static; moving actors and animated objects need dynamic handling. Parenting changes transform inheritance, while your gameplay layer decides ownership and destruction rules.

## 5. Separate simulation from presentation

`onFixedUpdate((dt, simulationSeconds) => ...)` runs zero or more times per browser frame. `dt` is the configured step in seconds. Put movement, combat cooldowns and collision decisions here. Normalize diagonal movement to avoid higher diagonal speed, as the sample does.

`onUpdate((frameDt, alpha) => ...)` runs once per rendered frame before animation/extraction. `alpha` is the fractional accumulator between fixed ticks. Keep previous/current simulation positions and interpolate the displayed transform. This presentation intentionally trails the latest tick by up to one step. Do not feed the interpolated position back into collision rules.

The simulation loop caps frame time and catch-up steps to avoid unbounded work after a stall. This can discard excess elapsed time; a network simulation must define its own synchronization policy. Use `app.pause()` / `app.resume()` to stop and resume both simulation and rendering. A pause menu that remains animated should instead gate gameplay in your hooks. `app.stop()` stops the browser frame loop; `app.start()` starts/resumes it without creating another application.

## 6. Load levels and animated characters

Place deployable assets in `public/`, for example `public/models/hero.glb`. The corresponding URL is `/models/hero.glb`. Keep external glTF buffers/textures reachable relative to their document. Loading and uploading are asynchronous cold operations: do them at scene transitions, preload boundaries or explicit streaming stages rather than every frame.

```ts
// Create a scene lease; repeated URLs share uploaded assets but get separate scene entities.
const hero = await app.instantiateAsset("/models/hero.glb");
const animator = hero.animator;
if (animator && animator.clips.length > 0) {
  animator.loop = true;
  animator.play(0);
}
// Later: detach this scene, retaining cached resources for other instances.
await hero.dispose();
```

`hero.nodes` contains handles in imported node order, including nodes without a mesh. Renderer-created primitive children are excluded. Do not assume the first node is the animated root or that each node represents a renderable object. Inspect the asset hierarchy and clips when authoring your game. Give the character a game-owned parent/pivot when you need authoritative movement separate from authored node animation; avoid overwriting transforms that the animator writes.

`app.loadAsset(url)` returns numeric node IDs; `app.loadAssetHandles(url)` returns handles. Prefer a scene lease when you need one clearly disposable level/character instance. `app.cancelAssetLoad(url)` cancels pending work. `app.unloadAsset(url)` removes application-owned instances and shared resources for that URL; it can reject if another retained consumer still owns the resources. Dispose/release those consumers first. Load failure should show a recoverable game UI instead of silently leaving a partially constructed level.

The importer supports the formats/extensions documented in [README.md](README.md); use `pnpm run validate:codecs` when changing compressed asset workflows.

## 7. Control animation

An imported scene's animator owns its clips and pose evaluation. Select clips from the actual asset; index zero is not guaranteed to be idle. `play(index)`, `pause()`, `stop()`, `speed`, `loop`, `currentTime` and `crossFade(index, seconds)` control playback. `currentTime` can seek; speeds can include reverse playback subject to the clip's behavior.

Layered animation uses `addLayer` with a clip, weight, mode (`override` or `additive`) and an optional authored node mask. Remove layers with `removeLayer` or `clearLayers`. Masks use imported node indices rather than world entity IDs. Match additive reference poses to the asset's authored animation.

Use `setEvents(clipIndex, markers)` and `onEvent(callback)` for clip markers such as footsteps. Retain the unsubscribe function. Rendering events should not be your sole authority for networked hits or physics: the game simulation must decide those outcomes.

For root motion, [RootMotionSampler.ts](src/animation/RootMotionSampler.ts) extracts rigid transform deltas between caller-owned unwrapped clip times, including loop seams. Apply the delta to the gameplay actor at fixed ticks and use the animator's in-place root option to avoid applying motion twice. Sampling does not automatically move an entity or perform collision. The root node and clip must match the imported character.

Animation evaluates poses on the CPU; skinning/morph deformation occurs on the GPU. Reuse scratch arrays and clip/layer objects, share assets and measure actual character counts. Do not introduce CPU vertex deformation into the regular frame path.

## 8. Choose a camera and input scheme

The simplest camera is `app.renderer.camera`. Configure its position/target and select perspective or orthographic projection:

```ts
app.renderer.camera.setPosition(0, 4, 8);
app.renderer.camera.setTarget(0, 1, 0);
app.renderer.camera.setPerspective({ fovY: Math.PI / 3, near: 0.1, far: 200 });
// For an orthographic game, height is the vertical view span in world units.
app.renderer.camera.setOrthographic({ height: 18, near: 0.1, far: 200 });
```

For entity-driven cameras, add a camera component and transform, then select it with `app.setActiveCamera(handle)`. `app.setActiveCamera(null)` returns control to the direct renderer camera. The camera system derives an entity camera's view from its transform.

| Helper                         | Use                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `KeyboardInput(canvas, codes)` | Focus-scoped held keys and consumable press edges. Make the canvas focusable.  |
| `PointerInput(canvas)`         | Pointer drag and wheel deltas; consume into a reusable three-element array.    |
| `GamepadInput(canvas)`         | Poll with `update()` in simulation; read axes/buttons and consume press edges. |
| `TouchJoystick(element)`       | A game-owned touch target exposing movement axes.                              |
| `OrbitCameraController`        | Orbit/zoom from pointer deltas.                                                |
| `ThirdPersonCameraController`  | Follow a character position with smoothing and optional orbit input.           |

The helpers clear held state on focus loss. Dispose them when leaving a scene. A camera controller does not supply wall collision: implement that in your game. Controllers retain a camera reference; if device recovery replaces the renderer, rebuild/rebind your controllers to its current camera.

## 9. Add materials, lighting and adjustable effects

Create PBR materials with `app.materials.create({ baseColor, metallic, roughness, emissive, ... })`. `baseColor` includes alpha; `alphaMode` is `OPAQUE`, `MASK` or `BLEND`. Shared materials reduce batching variety. Use authored glTF textures/materials for asset-based environments.

Lights are world components. Point/spot lights use their entity transform for placement; a directional light represents a direction rather than distance attenuation. Cone angles are radians. The bootstrap application already creates a directional light, so adjust it rather than accidentally doubling illumination. Directional shadow support is the implemented shadow path; do not assume point/spot shadows.

```ts
world.lights.set(app.defaultLightEntity, {
  type: "directional",
  color: [1, 0.95, 0.85],
  intensity: 3,
  direction: [-0.4, -0.6, -1],
  castShadow: true,
});
app.renderer.shadows.enabled = true;
app.renderer.hdr.enabled = true;
app.renderer.hdr.toneMapping = "filmic";
app.renderer.hdr.exposure = 0; // Stops: +1 doubles linear radiance before tone mapping.
app.renderer.hdr.bloomStrength = 0.2; // Zero disables bloom work.
app.renderer.hdr.bloomThreshold = 1;
app.renderer.hdr.autoExposure = false;
app.renderer.hdr.antialiasing = "fxaa";
app.gpu.renderScale = 1; // Scales physical render resolution, not gameplay coordinates.
```

HDR renders linear radiance into a half-float target before presentation. Tone mapping supports `reinhard`, `clamp` and `filmic`. Bloom and automatic exposure require HDR; FXAA can use the presentation target without enabling HDR exposure. Tune lighting/materials first, then exposure and bloom. Exposure is validated in [-16, 16] stops; bloom strength in [0, 5]. Resolution scale is validated in [0.25, 2]. Higher scale increases pixel cost substantially.

Load image-based lighting with `await app.loadEnvironment("/environments/room.hdr")`; supported workflows also include EXR and prebaked `.envbin`. Enable `app.renderer.skybox.enabled` if the environment should be visible behind the scene. Environment loading/baking is a cold operation. Use `pnpm run bake:environment` with the options described in the README to prepare deployable environment assets.

Phase 44 geometry optimization is enabled by default on adapters supporting `indirect-first-instance`. It remains configurable with `app.renderer.geometryOptimization.enabled = false`. It applies to eligible static, deformation-free triangle geometry; unsupported or ineligible objects use the normal path. It does not replace skinned animation or make every mesh a cluster workload.

Other controls include culling, `visibilityMode` (`linear` or `bvh`), depth prepass, clustered lighting and submission mode. Change them at explicit settings boundaries, then benchmark your scene. Enable BVH handling only with correct static/dynamic flags. Read [README.md](README.md) for supported combinations and diagnostic counters.

## 10. Picking and collision

For selection, pass browser client coordinates to `app.pick`:

```ts
/** Resolves pointer selection against the latest render bounds and validates entity identity. */
function select(event: PointerEvent): void {
  const handle = app.pick(event.clientX, event.clientY);
  if (handle === null) return;
  const id = world.resolve(handle);
  if (id !== null) console.log("Selected entity", id);
}
canvas.addEventListener("pointerdown", select);
// Scene teardown must remove this listener.
```

Picking performs a CPU bounds query without a GPU readback. It is a conservative bounds hit rather than exact triangle/material-alpha intersection. Queries use the latest extracted snapshot, which can be behind authoritative simulation. `app.spatial` offers ray/AABB queries for broadphase work; returned render-object indices must be mapped through the snapshot, rather than treated as world entity IDs.

For gameplay collision, maintain authoritative simulation shapes/state. Add narrow-phase contact tests, sweeps and response rules as your game requires. This renderer does not provide a rigid-body physics solver, navigation, multiplayer synchronization or a full audio system.

## 11. Handle scene transitions, cleanup and recovery

Retain unsubscribe functions from frame/fixed/animation hooks. At a scene transition, unsubscribe them, dispose input/controllers' owned listeners, detach scene leases, destroy game-owned entities and remove game-owned DOM. Release shared cached assets only when their consumers are finished. Destroying a single entity does not imply that its shared mesh/material should be destroyed.

Call `await app.dispose()` when the whole application is finished. It releases application GPU/worker/lifecycle ownership. Keep teardown idempotent, as in the sample, so page navigation and explicit game exit cannot race into duplicate cleanup.

Unexpected device loss pauses rendering and normally triggers recovery (`app.autoRecoverDevice` defaults to true). Observe `app.deviceState` for recovery/failure UI. The world persists, but GPU context/renderer owners can be replaced. Resolve `app.renderer` and `app.gpu` at use time; rebuild helpers retaining old GPU/camera references. A failed recovery needs a retry/reload path appropriate to your game.

## 12. Validate and measure your game

Run checks after changing the renderer or its integration:

```sh
pnpm run lint
pnpm run format:check
pnpm test
pnpm run build
pnpm run validate       # Full ordered gate, including browser/GPU scenarios.
pnpm run benchmark     # CPU microbenchmarks.
pnpm run benchmark:gpu # Rendering matrix with GPU/browser evidence.
pnpm run profile:animation
```

The full gate stops at the first failed prerequisite. GPU checks require the configured browser and functioning WebGPU; a skipped/unavailable device is not proof of correctness. Timing depends on hardware, browser, resolution and scene composition. Compare equivalent scenes/settings and inspect medians/tails alongside draw, upload, visibility and resource counters.

Keep loading, resource creation, pipeline compilation and shader variant setup out of ordinary frame callbacks. Preallocate scratch storage, share mesh/material resources, avoid per-object temporary arrays, keep spatial bounds correct and use the existing animation/GPU deformation path. Optional effects can increase frame cost even if draw count stays unchanged. Measure the complete game loop rather than extrapolating from an isolated animation benchmark.

A practical development order is: playable fixed-step prototype → reliable entity/scene lifetime → authored assets and animation → camera/input UX → lighting/post effects → scene-specific performance profiling → production validation. Keep [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) as the architecture/performance source of truth and consult [PROGRESS.md](PROGRESS.md) for current evidence and limits.
