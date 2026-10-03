import { bench, describe } from "vitest";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
describe("Phase 8 shared material baseline", () => {
  for (const count of [1, 100, 1000])
    bench(`${count} material records`, () => {
      const m = new MaterialManager(count);
      for (let i = 0; i < count; i++)
        m.create({ metallic: 0.5, roughness: 0.5 });
    });
});
