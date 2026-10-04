import { bench, describe } from "vitest";
import { Mat4 } from "../src/math/Mat4";
import { Camera } from "../src/rendering/Camera";
const a = Mat4.create(),
  b = Mat4.create(),
  out = Mat4.create(),
  camera = new Camera();
describe("Phase 3 math baseline", () => {
  // Groups checks for Phase 3 math baseline.

  bench("10,000 persistent-output matrix multiplies", () => {
    // Measures 10,000 persistent-output matrix multiplies.

    for (let i = 0; i < 10000; i++) Mat4.multiply(out, a, b);
  });
  bench("1,000 dirty camera updates", () => {
    // Measures 1,000 dirty camera updates.

    for (let i = 0; i < 1000; i++) {
      camera.setPosition(3 + i * 0.001, 2, 5);
      camera.update(4 / 3);
    }
  });
});
