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
