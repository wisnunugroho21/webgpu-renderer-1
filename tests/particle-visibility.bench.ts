import { bench } from "vitest";
import { ParticleVisibility } from "../src/rendering/particles/ParticleVisibility";
import { ParticleSystem } from "../src/particles/ParticleSystem";
for (const count of [1000, 10000]) {
  const system = new ParticleSystem(count);
  system.enabled = true;
  system.burst(
    {
      positionSpread: [10, 10, 10],
      velocitySpread: [1, 1, 1],
      lifetime: [100, 100],
    },
    count,
  );
  const visibility = new ParticleVisibility();
  visibility.prepare(
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  );
  let visible = 0;
  bench(`${count} analytic particle frustum bounds`, () => {
    // Count conservative billboard intersections using retained scratch and immutable records.
    visible = 0;
    for (let i = 0; i < count; i++)
      visible += Number(visibility.billboard(system, i));
    if (visible > count) throw new Error("Invalid visibility count");
  });
}
