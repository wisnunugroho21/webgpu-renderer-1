import { bench, describe } from "vitest";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderQueue } from "../src/rendering/RenderQueue";
import { RenderSorter } from "../src/rendering/RenderSorter";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { Mat4 } from "../src/math/Mat4";
describe("Phase 9: sort 10,000 objects", () => {
  // Groups checks for Phase 9: sort 10,000 objects.

  for (const count of [1, 100, 1000]) {
    const w = new RenderWorld(10000),
      m = new MaterialManager(count),
      q = new RenderQueue(10000),
      sorter = new RenderSorter(),
      view = Mat4.create();
    w.count = 10000;
    for (let i = 0; i < count; i++) m.create();
    for (let i = 0; i < w.count; i++) {
      w.materialId[i] = i % count;
      w.sphere[i * 4 + 2] = -i % 100;
    }
    bench(`${count} materials`, () => {
      // Measures Phase 9: sort 10,000 objects.

      q.build(w, m, view);
      sorter.sort(q, w);
    });
  }
});
