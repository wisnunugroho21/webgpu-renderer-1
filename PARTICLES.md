# Particles and visual effects

Particles are world-space, camera-facing billboards with GPU-evaluated motion, size, rotation, color and lifetime fades. A bounded CPU pool retains spawn records; reusable emitters and event bursts share three GPU buffers and at most two draws. They render after scene geometry and before HDR bloom, exposure, tone mapping and FXAA.

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

Each spawn record contains seven vec4 values, 112 bytes. The renderer retains one capacity-sized storage table, one 4-byte-per-particle ordering table and one 112-byte camera/time uniform: 475,248 GPU bytes at the default capacity. Four bounded pipelines cover two blend modes and direct/half-float targets, with one shared layout/group. Empty or disabled systems encode no particle pass. GPU objects are retained after disabling and destroyed with renderer/application resources.

Motion uses analytic ballistic acceleration and optional exponential drag in WGSL. There is no CPU vertex simulation, GPU readback or per-frame compute simulation. CPU work scans lifetimes and sorts alpha centers with persistent radix scratch; additive particles skip sorting. Spawn/compaction writes dirty record ranges. When live records and ordering are unchanged, rendering uploads only the 112-byte camera/time uniform. Changed order costs four bytes per live particle; births/retirements can widen the dirty record range. Do not write `records`, revisions or dirty flags directly.

Use one active renderer per system; its GPU owner consumes the dirty upload bookkeeping. Device recovery replaces that owner. Particle provenance belongs to `app.particles` and survives device recovery. A replacement renderer uploads retained records to its new device, with no simulation reset. Use the current `app.renderer` after recovery. `await app.dispose()` retires emitters and GPU resources; scene-level emitter disposal does not destroy shared GPU buffers.

## Limits and measurement

Particles are unlit procedural billboards. The current API does not include sprite textures/atlases, ribbons, mesh particles, soft depth-intersection fades, collision, trails or arbitrary particle shaders. Alpha sorting uses particle centers; it does not globally interleave particles with transparent scene meshes, and additive particles draw after the alpha group. Large/intersecting transparent billboards can therefore show ordering artifacts. Geometry culling/Phase 44 applies to scene meshes, not the separate particle pool; offscreen billboards still incur vertex work before GPU clipping.

Inspect `app.renderer.stats.particleCount`, `particleDrawCalls`, `particleUploadBytes`, `particleRecordUploadBytes` and cumulative `particleDropped`. Total draw/triangle/pipeline-switch/upload counters also include particle work. Two draws do not imply a cheap effect: large overlapping billboards can become fill-rate heavy, especially with HDR/bloom or high render scale. Keep pool size, emission rate, lifetime and billboard size appropriate for your scene.

```sh
pnpm run validate:particles
pnpm exec vitest bench --run tests/particles.bench.ts
pnpm run validate
```

The browser gate checks procedural coverage, linear colors, alpha ordering/camera movement, additive blending, depth, GPU motion/fades, disabled resource behavior, HDR/bloom/FXAA, resize, device recovery, demo controls, warm resource reuse and teardown. Diagnostic image readbacks/completion waits are outside ordinary rendering. See [benchmarks/PARTICLES_REPORT.md](benchmarks/PARTICLES_REPORT.md) for measured workloads and limits.
