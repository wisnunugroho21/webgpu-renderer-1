import { bench } from "vitest";
import { bakeEnvironment } from "../src/rendering/environment/bakeEnvironment";
bench(
  "Cold HDR bake: 16px GGX cube / 4px diffuse / 16px BRDF, 64 samples",
  () => {
    // Measures Cold HDR bake: 16px GGX cube / 4px diffuse / 16px BRDF, 64 samples.

    bakeEnvironment(
      (direction, out) => {
        // Updates out[0], out[1], out[2] for this callback.

        out[0] = 0.1 + Math.max(0, direction[1]!);
        out[1] = 0.2;
        out[2] = 0.5;
      },
      { specularSize: 16, diffuseSize: 4, brdfSize: 16, samples: 64 },
    );
  },
);
