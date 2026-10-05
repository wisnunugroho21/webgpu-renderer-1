# Particles and visual effects

Particles are world-space, camera-facing billboards with GPU-evaluated motion, size, rotation, color and lifetime fades. A bounded CPU pool retains spawn records; reusable emitters and event bursts share four GPU buffers and at most two billboard draws. They render after scene geometry and before HDR bloom, exposure, tone mapping and FXAA.

The feature starts **disabled** and allocates no particle GPU resources until you enable it. Try `/?example=particles`: click the canvas, Space creates an explosion/shockwave, C emits confetti, P pauses particles, and B toggles bloom.

## Start a reusable emitter

After `await app.start()`:

```ts
app.particles.enabled = true;
const flame = app.particles.createEmitter({
  position: [0, 1, 0],
  positionSpread: [0.15, 0, 0.15],
  velocity: [0, 1.5, 0],
  velocitySpread: [0.3, 0.4, 0.3],
  lifetime: [0.5, 1.2],
  rate: 60,
  startColor: [4, 0.8, 0.1, 1],
  endColor: [0.5, 0.05, 0, 0],
  startSize: 0.15,
  endSize: 0.5,
  shape: "glow",
  blend: "additive",
});
app.renderer.hdr.enabled = true;
app.renderer.hdr.bloomStrength = 0.25;
flame.burst(30); // Returns accepted particles, respecting the shared pool capacity.
```

`Application` advances the particle clock once per displayed frame after gameplay hooks. Do not also call `app.particles.update()` from your game hooks. Standalone use of `ParticleSystem`/`Renderer` requires the caller to advance the system once per frame with elapsed seconds.

Move an emitter with `flame.setPosition(x, y, z)`; live particles retain their original world-space spawn location. Adjust `flame.rate` in particles/second, or set `flame.emitting = false` to stop continuous emission while allowing explicit bursts. `flame.configure(options)` replaces the entire spawn configuration with validated defaults for omitted fields, resets its fractional emission remainder and seed, and leaves already spawned particles intact. Caller arrays are copied on installation.

`flame.dispose()` releases the emitter slot and stops future emission. Its live particles continue until their lifetimes end. Retain and dispose scene-owned emitters on a scene transition. `app.particles.clear()` removes all live particles while retaining emitters, their rate settings and fractional remainders. Disable emitters before clearing if you do not want them to repopulate the pool.

## Trigger one-shot effects

```ts
app.particles.playEffect("sparks", [x, y, z]);
app.particles.playEffect("smoke", [x, y, z]);
app.particles.playEffect("explosion", [x, y, z], 1.5);
app.particles.playEffect("confetti", [x, y, z]);
app.particles.playEffect("shockwave", [x, y, z]);
// Custom bursts do not occupy a retained emitter slot.
app.particles.burst({ position: [x, y, z], shape: "disc" }, 12);
```

These calls return the number of particles accepted. The optional effect scale multiplies size, launch speed, velocity variation and gravity, preserving duration. Presets are seeded and repeatable; use a custom emitter/burst for different colors or motion. A shockwave is an expanding camera-facing ring, rather than a world-oriented ground decal.

Call effects from gameplay events such as hits, pickups or ability activation. Each event creates one bounded configuration, with no per-particle JavaScript objects or GPU resources. Registering a new emitter on every tick can exhaust emitter slots; use a reusable emitter for continuous effects or the one-shot API for events.

## Adjustable settings

| Setting                       | Meaning/default                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `position`                    | World-space origin, `[0, 0, 0]`                                                   |
| `positionSpread`              | Nonnegative per-axis spawn-box half extents, zero                                 |
| `velocity`                    | World units/second, `[0, 1, 0]`                                                   |
| `velocitySpread`              | Nonnegative per-axis random velocity half ranges, `[1, 1, 1]`                     |
| `gravity`                     | Constant acceleration in world units/second², zero                                |
| `drag`                        | Exponential damping per second, zero; valid [0, 100]                              |
| `lifetime`                    | Uniform minimum/maximum seconds, `[1, 2]`; valid [0.001, 3600]                    |
| `startColor`, `endColor`      | Linear RGBA; RGB nonnegative finite f32, alpha [0, 1]; white to transparent white |
| `startSize`, `endSize`        | Billboard diameter in world units; defaults 0.2 and zero                          |
| `rotation`, `angularVelocity` | Initial radians and radians/second, zero                                          |
| `shape`                       | `disc`, `glow`, `ring`, or `square`; default `disc`                               |
| `blend`                       | `alpha` or `additive`; default `alpha`                                            |
| `fadeIn`, `fadeOut`           | Fractions of total lifetime, [0, 1]; defaults zero and one                        |
| `rate`                        | Continuous particles/second, zero; valid [0, 1,000,000]                           |
| `seed`                        | Deterministic uint32 random state, default 1                                      |

Color and size interpolate over normalized lifetime. Fade windows additionally multiply the interpolated alpha. Radiance above one benefits from HDR/bloom. Additive particles accumulate light-like radiance; alpha particles composite premultiplied color in back-to-front center order. Both use the scene camera, including orthographic projection, and depth-test against scene geometry without writing depth or casting shadows.

`app.particles.enabled = false` hides particles and freezes their clock/emission. Enabling again resumes retained state and reuses prepared resources. Disabled burst/effect calls return zero. Emitter installation/settings and burst counts are validated before mutation. A full pool drops newest requested particles and increments `app.particles.dropped`; it never grows buffers or replays a missed-emission backlog.

## Capacity, ownership and recovery

The default application supports 4,096 particles and 64 reusable emitters. For a different fixed capacity, supply a system when creating the application:

```ts
import { Application } from "./app/Application";
import { ParticleSystem } from "./particles/ParticleSystem";

const app = new Application(
  canvas,
  status,
  16384, // Gameplay entity capacity.
  16384, // Extracted render-object capacity.
  new ParticleSystem(10000, 128), // Particle and emitter capacities.
);
```

Particle capacity is validated in [1, 65,536], emitter capacity in [1, 1,024]. Capacity cannot be resized after installation. Particles do not consume ECS entity slots, mesh IDs or material IDs. Their procedural shader is independent of custom mesh surface material families.

Each spawn record contains nine vec4 values, 144 bytes. The renderer retains one capacity-sized storage table, one 4-byte-per-particle ordering table and one 144-byte camera/time/projection/atlas uniform plus a 9,216-byte shared curve table: 615,568 GPU buffer bytes at the default capacity. Four bounded pipelines cover two blend modes and direct/half-float targets, with one shared layout/group and one atlas texture (a white 1×1 fallback before atlas installation). Empty or disabled systems encode no particle pass. GPU objects are retained after disabling and destroyed with renderer/application resources.

Motion uses analytic ballistic acceleration and optional exponential drag in WGSL. There is no CPU vertex simulation, GPU readback or per-frame compute simulation. CPU work scans lifetimes and sorts alpha centers with persistent radix scratch; additive particles skip sorting. Spawn/compaction writes dirty record ranges. When live records and ordering are unchanged, rendering uploads only the 144-byte frame uniform. Changed order costs four bytes per live particle; births/retirements can widen the dirty record range. Do not write `records`, revisions or dirty flags directly.

Use one active renderer per system; its GPU owner consumes the dirty upload bookkeeping. Device recovery replaces that owner. Particle provenance belongs to `app.particles` and survives device recovery. A replacement renderer uploads retained records to its new device, with no simulation reset. Use the current `app.renderer` after recovery. `await app.dispose()` retires emitters and GPU resources; scene-level emitter disposal does not destroy shared GPU buffers.

## Limits and measurement

Particles are unlit billboards with optional atlas animation, curves and soft depth fades; ribbons use bounded world-space histories. The API does not include mesh particles, collision or arbitrary particle shaders. Alpha sorting uses particle centers; it does not globally interleave particles with transparent scene meshes, and additive particles draw after the alpha group. Large/intersecting transparent billboards can therefore show ordering artifacts. Geometry culling/Phase 44 applies to scene meshes, not the separate particle pool; offscreen billboards still incur vertex work before GPU clipping.

Inspect `app.renderer.stats.particleCount`, `particleDrawCalls`, `particleUploadBytes`, `particleRecordUploadBytes` and cumulative `particleDropped`. Total draw/triangle/pipeline-switch/upload counters also include particle work. A small draw count does not imply a cheap effect: large overlapping billboards can become fill-rate heavy, especially with HDR/bloom or high render scale. Keep pool size, emission rate, lifetime and billboard size appropriate for your scene.

```sh
pnpm run validate:particles
pnpm exec vitest bench --run tests/particles.bench.ts
pnpm run validate
```

The browser gate checks atlas playback, lifetime curves, soft depth fades, ribbon joins/blends/recovery and procedural coverage, linear colors, alpha ordering/camera movement, additive blending, depth, GPU motion/fades, disabled resource behavior, HDR/bloom/FXAA, resize, device recovery, demo controls, warm resource reuse and teardown. Diagnostic image readbacks/completion waits are outside ordinary rendering. See [benchmarks/PARTICLES_REPORT.md](benchmarks/PARTICLES_REPORT.md) for measured workloads and limits.

## Maintaining the implementation

`src/particles/ParticleLayout.ts` names every spawn-field word offset and the padded frame-uniform size. Its nine vec4 rows match `src/shaders/particles.wgsl`. The spawn writer and alpha-depth calculation capture these immutable scalar constants once at module initialization so hot loops avoid repeated imported-value access. Existing size exports through ParticleOptions remain compatible.

`src/rendering/particles/createParticleResources.ts` owns cold GPU construction at enable/recovery boundaries. ParticleRenderer keeps lifetime-owner attachment, analytic ordering, dirty uploads, draw grouping and counters. Resources retains destruction ownership. See [architecture](ARCHITECTURE.md) and [restructuring evidence](benchmarks/RESTRUCTURE_REPORT.md) for the maintenance boundaries.

## Sprite atlases and flipbooks

Install one shared, evenly tiled RGBA8 atlas during setup. Pixels are top-down and straight-alpha; RGB defaults to sRGB (decoded to linear by the GPU). Use `colorSpace: "linear"` for already-linear bytes. Frames run left-to-right, then top-to-bottom.

```ts
app.particles.setAtlas({
  width: 256,
  height: 256,
  columns: 4,
  rows: 4,
  pixels: rgbaPixels, // Uint8Array containing width * height * 4 decoded bytes.
});
const fire = app.particles.createEmitter({
  rate: 40,
  sprite: { firstFrame: 0, frameCount: 16, fps: 20, loop: true },
  shape: "square", // Keep the complete sprite; other shapes additionally mask it.
  startColor: [3, 1, 0.4, 1],
  endColor: [1, 0.1, 0, 0],
});
```

`firstFrame` defaults to zero, `frameCount` to one, and `loop` to false. Omit `fps` to play the selected range once over each particle's lifetime; explicit zero holds the first frame. Positive rates use elapsed seconds, clamping at the last frame unless looping. Omit `sprite` to retain procedural rendering. The texture multiplies linear particle tint and alpha before premultiplication. Atlas installation copies caller pixels and validates existing emitters/live frame ranges before replacement. A smaller replacement or `setAtlas(null)` can require disposing incompatible emitters and clearing their live particles first. Do not install textures in frame hooks.

Limits: maximum dimension 4,096, at most 4,096 evenly sized frames, maximum 64 MiB RGBA8 payload, and `fps` in [0, 1,000]. Sampling uses linear filtering at mip zero and a half-texel inset per tile to avoid neighboring frames. Pad source artwork if needed; distant sprites can alias because this atlas path does not generate mipmaps. Decoding an image is a cold asset operation: use `createImageBitmap`, draw it into a canvas, copy `getImageData(...).data` into a `Uint8Array`, then close the bitmap and install the pixels. Compressed atlas uploads and irregular packing are not part of this API.

## Directional emission and lifetime curves

Use a cone for jets/flames and a sphere for explosions:

```ts
const profile = app.particles.createCurve([
  { time: 0, size: 0.3, color: [1, 1, 1, 0] },
  { time: 0.2, size: 1, color: [1, 1, 1, 1] },
  { time: 0.7, size: 1.4, color: [0.5, 0.5, 0.5, 0.5] },
  { time: 1, size: 2, color: [1, 1, 1, 0] },
]);
fire.configure({
  rate: 40,
  velocity: [0, 0, 0],
  velocitySpread: [0, 0, 0],
  emission: {
    shape: "cone",
    direction: [0, 1, 0],
    angle: Math.PI / 12,
    radius: 0.15,
    speed: [1, 3],
  },
  curve: profile,
  softDistance: 0.25,
  sprite: { frameCount: 16 },
  shape: "square",
});
```

Cone `angle` is a half-angle in radians, [0, π/2], default π/8. `direction` is normalized on installation, default up. Cone positions fill a disk of `radius` perpendicular to that direction; directions sample uniformly over its solid angle. Sphere positions fill a volume of `radius` and emission directions cover all directions. `radius` defaults to zero and `speed` to [1, 1], both bounded to 10,000. The sampled speed is **added** to existing `velocity`/`velocitySpread`; set those to zero for a pure directed jet. Existing `positionSpread` adds box jitter independently. Seeded sampling is deterministic. Omitted emission preserves original box/velocity behavior.

Profiles have two to four strictly increasing normalized `time` keys including zero and one. Size and linear RGBA interpolate piecewise and multiply the existing start/end interpolation and fade windows. Omitted size/color multipliers are one. Size and RGB multipliers are [0, 100], alpha [0, 1]. Identical profiles share an ID; up to 64 profiles including identity zero live for the system's lifetime. IDs must be installed before assigning `curve`; profiles are immutable and not individually recycled. Create profiles once during setup, rather than generating them at each spell activation. `configure` replaces all settings, so repeat the settings you want to retain.

`softDistance` defaults to zero (ordinary hard depth testing). Positive values fade alpha from zero at an opaque surface to full opacity at that camera-depth separation in world units. Both camera projection types work; empty depth leaves coverage unchanged. Soft particles still depth-test, cannot show through foreground geometry, and fade against the main scene depth rather than transparent particles or transparent meshes that do not write depth. Sampling is conditional on positive distance and uses the already rendered depth target.

## Connected ribbons and projectile trails

Create a retained controller once, then append the projectile's interpolated world position from a gameplay hook:

```ts
const trail = app.particles.createTrail({
  maxPoints: 64,
  minDistance: 0.02,
  lifetime: 0.6,
  width: 0.08,
  color: [0.2, 1, 4, 1],
  endColor: [0.05, 0.1, 0.3, 0],
  blend: "additive",
  curve: profile,
  softDistance: 0.15,
});
const offTrail = app.onUpdate(() => {
  // Resolve the current interpolated projectile coordinates before the particle clock advances.
  trail.addPoint(projectileX, projectileY, projectileZ);
});
// Stop adding points on impact to let the retained tail expire.
// At scene cleanup: offTrail(); trail.dispose();
```

Points form connected camera-facing strips with bounded miter joins. Each endpoint ages independently; width/color curves and soft intersection fades run on the GPU. Width is the full strip diameter. Default history is 128 points, minimum distance 0.001, lifetime one second, width 0.1, alpha blend, white fading to transparent. Providing `color` alone keeps that tint while the independent lifetime alpha fade still reaches zero. Ribbons are procedural strips, without atlas texturing. Very sharp turns and paths along the viewing axis can flatten or overlap; a miter cap limits spikes.

`addPoint` returns false for points closer than `minDistance` or while the system is disabled. Full histories evict oldest points; they never grow or allocate per point. `trail.clear()` removes only that controller's history. `trail.dispose()` immediately removes its strip and releases its controller slot; stop appending instead if a lingering tail is desired. `app.particles.clear()` clears billboard particles and all histories while retaining controllers. Application disposal retires all controllers. Clock freeze/resume and device recovery retain history just like particles.

The default system permits 32 trails × 128 points = 4,064 segments. Customize at construction with `new ParticleSystem(10000, 128, { capacity: 16, pointsPerTrail: 256 })`. Trail capacity is [1, 128], point capacity [2, 512], total segments at most 65,536. Choose each controller's `maxPoints` within that budget. Creating a trail beyond controller capacity throws; dispose scene-owned controllers when finished. Numeric point buffers, packed records and settings are internal provenance: do not mutate them directly.

Two shared trail buffers and four ribbon pipeline variants are prepared only at first controller installation on an enabled system, enablement or recovery. Histories repack only after append, expiry or clearing; dirty rows/order upload then. Stable histories upload no vertices or points, only the shared frame uniform. Ribbons use at most two additional draws. Alpha segments sort by midpoint within their group; billboards and ribbons are separate groups, so overlapping alpha effects do not have a global sort. Use additive trails where appropriate and test intersecting effects in your scene. Inspect `particleTrailSegments` and `particleTrailUploadBytes` alongside billboard counters.
