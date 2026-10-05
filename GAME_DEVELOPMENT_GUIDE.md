# Creating a game with this renderer

This project provides rendering, an entity world, scene loading, animation, cameras, input helpers and a simulation loop. Your game supplies rules, authoritative movement, collision responses, progression, UI and audio. Start with `Application`; it already owns the browser frame loop and GPU lifetime.

## 1. Run the project

Use pnpm 12.6.0, as pinned in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Open the localhost URL printed by Vite in a WebGPU-capable browser. WebGPU requires a secure context; localhost is suitable for development. Run `pnpm run build` and `pnpm run preview` to try a production build.

The existing entry is [src/main.ts](src/main.ts). [index.html](index.html) provides `canvas#viewport` and `output#status`. Try `/?example=collect` for the complete collection game, `/?example=lighting` for a lighting scene, or `/?example=shaders` for procedural materials (M switches between PBR and the custom surface). The collection example supports keyboard, gamepad, touch, orbit and follow controls. Read [collect.ts](src/examples/collect.ts) and [CollectGame.ts](src/examples/CollectGame.ts) together: the former connects rendering/input; the latter owns simulation rules.

## 2. Understand the responsibilities

| Owner                      | What your game does with it                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `app.world`                | Creates entities and changes transform, mesh, bounds, light and camera components. |
| `app.onFixedUpdate`        | Advances authoritative gameplay by a fixed duration in seconds.                    |
| `app.onUpdate`             | Interpolates visuals and updates frame-dependent presentation before extraction.   |
| `app.materials`            | Creates shared PBR/custom material descriptions and updates their parameter rows.  |
| `app.renderer`             | Configures rendering and the direct camera; it consumes an extracted snapshot.     |
| `app.instantiateAsset`     | Loads a scene with independent entity lifetime and shared underlying assets.       |
| `app.pick` / `app.spatial` | Queries the latest extracted scene bounds.                                         |

The browser entry point creates the application, waits for startup and delegates demonstration selection to [installExample.ts](src/examples/installExample.ts). [createDefaultScene.ts](src/app/createDefaultScene.ts) creates the initial cube and directional light before GPU startup. `app.sceneEntity` and `app.defaultLightEntity` refer to those existing entities; reuse them in a prototype. Mesh/material slot zero belongs to the bootstrap cube. Loading an asset adds scene entities rather than replacing that cube, so remove its mesh component when you no longer want it visible:

```ts
app.world.meshes.remove(app.sceneEntity); // Keeps the entity and its transform alive.
```

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

For a level transition, first prevent gameplay from acting on the outgoing scene, unsubscribe its callbacks and dispose its input/controllers. Then `await` its lease's `dispose()` before releasing shared resources. Load the next lease and install its gameplay hooks only after loading succeeds. Catch load failures at your scene boundary and provide a retry/menu action; do not register another update hook on each retry without releasing the old hook. If an asynchronous load finishes after the player has left that scene, dispose the returned lease instead of keeping its entities active.

The distinction between a scene lease and the cached asset matters: two calls to `instantiateAsset` create independent entities while sharing meshes, materials and textures. Disposing one lease removes only its entities. `unloadAsset(url)` is the separate shared-resource retirement operation and rejects unsafe removal while retained consumers exist. If you intentionally keep an asset cached for another level, detach the lease without unloading the URL.

Decoding and publication have separate responsibilities. [convertRuntimeAsset.ts](src/assets/gltf/convertRuntimeAsset.ts) coordinates pure geometry/material/scene conversion into the named records in [RuntimeAsset.ts](src/assets/gltf/RuntimeAsset.ts). Decoded accessor/image arrays belong to the runtime asset and can cross worker boundaries. These conversion helpers do not spawn entities or create GPU resources; scene lifetime and publication go through the application asset APIs.

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

### Add a custom shader material

Register a WGSL surface family after `await app.start()` and before gameplay starts. This example assumes `app`, `world` and `player` from the playable sample. It replaces the player's cube material with an unlit pulse; lights are not automatically applied to a custom shader's returned RGB.

```ts
const pulseShader = await app.registerMaterialShader({
  name: "game-pulse",
  source: `
// Shade the existing surface using shared elapsed time; geometry and alpha stay renderer-owned.
fn shadeMaterial(surface: MaterialSurface, parameters: MaterialShaderParameters) -> vec3<f32> {
  let pulse = 0.75 + 0.25 * sin(parameters.values[0].x * 3.0);
  return surface.baseColor.rgb * pulse;
}`,
});
const pulseMaterial = app.materials.create({
  shaderId: pulseShader,
  baseColor: [0.2, 0.8, 1, 1],
  shaderParameters: [0],
});
world.meshes.set(player, 0, pulseMaterial);
const pulseParameters = new Float32Array(4);
const offPulse = app.onUpdate((dt) => {
  // Retain the parameter array; update one shared row without uploading mesh vertices.
  pulseParameters[0] = pulseParameters[0]! + dt;
  app.materials.setShaderParameters(pulseMaterial, pulseParameters);
});
// During scene cleanup: offPulse();
```

The material's vertex color and base-color texture already contribute to `surface.baseColor`, so the default cube's colored faces affect the result. Return linear RGB radiance; presentation performs gamma conversion and, when enabled, tone mapping. For renderer lighting, use the surface fields and lighting helpers described in [CUSTOM_MATERIALS.md](CUSTOM_MATERIALS.md).

Each material has at most 16 finite f32 parameters, exposed as four vec4 values. JavaScript indices 0–3 map to `parameters.values[0]`, 4–7 to `values[1]`, and so on. The setter zero-pads unspecified values and marks a 64-byte row dirty. Reuse arrays and call setters only when values need changing; calling with identical values still schedules an upload. A material shared by multiple entities animates all of them together. Separate material IDs are needed for independent parameter rows and can increase batch diversity.

Switch an existing material with `app.materials.setShader(id, pulseShader)` or return to PBR with `setShader(id, 0)`. These preserve PBR factors, texture metadata and existing custom parameters; an optional third argument replaces the parameter row. In contrast, `materials.set(id, description)` replaces the description: omitted shader ID selects PBR and omitted parameters reset to zero. Use setters rather than writing the exposed parameter arrays directly.

Register families during loading; compilation and direct/HDR/environment pipeline preparation are cold work. Registration rejects invalid WGSL without publishing a family ID. Identical name/source registrations reuse their ID; different source under the same name is rejected. Up to 16 custom families are retained for the application lifetime, with no unregister/hot-reload API. Recovery rebuilds definitions and parameters from CPU state. Avoid retaining an old renderer reference across recovery.

Custom surface shaders return RGB only. Material alpha mode/cutoff, blending, shadows, depth, morphs and skinning keep their existing behavior. Vertex displacement, new discard rules, fragment depth and arbitrary bindings are outside this API. HDR/bloom can consume radiance above one. Test the actual material with the submission modes and effects your game enables; see [CUSTOM_MATERIALS.md](CUSTOM_MATERIALS.md) for complete contracts and `/?example=shaders` for a working example.

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

## 13. Organize your game and find the right extension point

Keep game rules in your own model module, as [CollectGame.ts](src/examples/CollectGame.ts) does. Connect the model to world components, input and HUD in a scene module, as [collect.ts](src/examples/collect.ts) does. Let `main.ts` create the application, choose the scene and handle application exit. Store cleanup callbacks with the scene that owns them. New games can use their own folder; the `examples` directory demonstrates integration rather than requiring all gameplay to live there.

| Goal                                                        | Use or read first                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Add player movement, pickups or damage                      | `app.onFixedUpdate`, your game model, component setters                              |
| Smooth motion, update a camera or animate shader parameters | `app.onUpdate`, reusable presentation state                                          |
| Load/despawn a level or character                           | `app.instantiateAsset`, scene leases, `ApplicationAssets.ts`                         |
| Add authored animation                                      | The lease's animator; clip, mask and root-motion APIs                                |
| Add a procedural visual style                               | `app.registerMaterialShader`, `materials.setShaderParameters`, `CUSTOM_MATERIALS.md` |
| Adjust presentation or quality settings                     | Renderer HDR/environment/visibility/geometry controls                                |
| Add an engine material feature                              | `MaterialManager.ts` and `MaterialShaderParameters.ts`                               |
| Change shader assembly, bindings or pipeline variants       | `rendering/pipelines/createColorResources.ts` and its focused helpers                |
| Change imported metadata                                    | `assets/gltf/convertGeometry.ts`, `convertMaterials.ts`, `convertScene.ts`           |
| Change GPU submission                                       | `rendering/passes/ColorPass.ts`, `Renderer.ts`, the render graph                     |

Follow the existing ownership boundaries when extending the engine. Shader registration lives in `CustomMaterialShaders.ts`; drawing reads its prepared tables. GPU destruction stays with the renderer's resource owners. Material parameter changes use one shared dirty-range upload. Passes consume `RenderWorld` rather than reaching into the ECS. Do not create per-object buffers, compile shaders each frame or add normal-frame GPU readbacks to implement a game effect.

Use [ARCHITECTURE.md](ARCHITECTURE.md) for the module contracts and [benchmarks/CODEBASE_MAINTENANCE_REPORT.md](benchmarks/CODEBASE_MAINTENANCE_REPORT.md) for the restructuring's validation evidence. A scene-specific game feature normally belongs in your model/scene code; change renderer internals when it needs a new rendering capability shared by multiple games or scenes.

## 14. Add particles to gameplay events

Continuing the playable sample with its `app`, `x` and `z`, enable the persistent particle system and retain a scene-owned emitter:

```ts
app.particles.enabled = true;
const exhaust = app.particles.createEmitter({
  rate: 40,
  position: [0, 1, 0],
  velocity: [0, 1, 0],
  lifetime: [0.5, 1],
  shape: "glow",
  blend: "additive",
  startColor: [0.1, 0.8, 3, 1],
  endColor: [0.02, 0.1, 0.3, 0],
});
const offExhaust = app.onUpdate(() => {
  // Follow the actor without moving particles that were already spawned.
  exhaust.setPosition(x, 0.35, z);
});
// Call this on a hit/pickup rather than constructing an emitter each frame.
app.particles.playEffect("sparks", [x, 0.35, z]);
// Scene transition: offExhaust(); exhaust.dispose();
```

The application advances particle lifetimes automatically after gameplay hooks. Do not add a second update loop for the same system. Disable with `app.particles.enabled = false` to hide/freeze effects; stop individual emission with `exhaust.emitting = false` and adjust density with `exhaust.rate`. Clear scene particles explicitly when leaving a level; disable/dispose its continuous emitters before clearing.

Sparks, smoke, explosion, confetti and shockwave presets are event bursts and do not occupy retained emitter slots. Custom emitter settings control origin/spread, velocity/spread, gravity, drag, lifetime, color, size, rotation, fade windows and alpha/additive blending. Use HDR/bloom for radiance above one. Effects depth-test without writing depth or casting shadows, and render before presentation effects.

Particles use a separate bounded pool rather than ECS entities or PBR materials. Default capacity is 4,096 particles/64 emitters; overflow drops new requests and is visible in renderer particle counters. Device recovery retains the same CPU system and reuploads records to the replacement renderer. Follow [PARTICLES.md](PARTICLES.md) for capacity customization, cleanup and sorting limits; `/?example=particles` demonstrates controls. Billboard overlap can cost more GPU time than its small draw count suggests, so benchmark the effects at your game's resolution and worst-case density.
