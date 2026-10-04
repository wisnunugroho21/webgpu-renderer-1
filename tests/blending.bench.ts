import { bench, describe } from "vitest";
import { AnimationPose } from "../src/animation/AnimationPose";
const base = new AnimationPose("rotation", 4),
  target = new AnimationPose("rotation", 4);
base.copy([0, 0, 0, 1]);
target.copy([0, 0, 1, 0]);
const rotations = Array.from(
  { length: 10000 },
  () =>
    /** Creates AnimationPose storage for this operation. */ new AnimationPose(
      "rotation",
      4,
    ),
);
describe("Phase 26 component blending", () => {
  // Groups checks for Phase 26 component blending.

  bench("10,000 persistent quaternion crossfade poses", () => {
    // Measures 10,000 persistent quaternion crossfade poses.

    for (const pose of rotations) {
      pose.copy(base.values);
      pose.blend(target, 0.5);
    }
  });
});
