import { bench } from "vitest";
import { ParticleSystem } from "../src/particles/ParticleSystem";
for (const count of [1000, 10000]) {
  const system = new ParticleSystem(count);
  system.enabled = true;
  const emitter = system.createEmitter({ lifetime: [3600, 3600] });
  emitter.burst(count);
  bench(`${count} analytic particle lifetime ticks`, () => {
    // Measure bounded retirement scanning without CPU vertex simulation or spawn uploads.
    system.update(0);
  });
  bench(`${count} particle burst records`, () => {
    // Reuse the same pool and emitter; include spawn-table writes and seeded variation.
    system.clear();
    emitter.burst(count);
  });
}

const directional = new ParticleSystem(10000);
directional.enabled = true;
const cone = directional.createEmitter({
  velocity: [0, 0, 0],
  velocitySpread: [0, 0, 0],
  emission: { shape: "cone", radius: 0.2, speed: [1, 3] },
});
bench("10000 directional cone burst records", () => {
  // Include uniform solid-angle sampling and packed writes without rendering or per-particle objects.
  directional.clear();
  cone.burst(10000);
});

const ribbons = new ParticleSystem(1, 1, { capacity: 8, pointsPerTrail: 128 });
ribbons.enabled = true;
const histories = Array.from({ length: 8 }, () => {
  // Allocate controllers once outside the measured history updates.
  return ribbons.createTrail({ lifetime: 3600 });
});
for (const trail of histories)
  for (let i = 0; i < 128; i++) trail.addPoint(i, 0, 0);
ribbons.trails.prepare();
let ribbonStep = 128;
bench("1016 ribbon segments append and snapshot", () => {
  // Reuse wrapped rings and the same dense table without per-point or vertex allocations.
  for (const trail of histories) trail.addPoint(ribbonStep, 0, 0);
  ribbonStep = ribbonStep === 100000 ? 128 : ribbonStep + 1;
  ribbons.trails.prepare();
});
bench("1016 ribbon segments clock-only ticks", () => {
  // Steady histories scan oldest timestamps but skip snapshot packing.
  ribbons.update(0);
  ribbons.trails.prepare();
});
