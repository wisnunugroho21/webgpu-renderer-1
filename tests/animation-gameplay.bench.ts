import { bench } from "vitest";
import { AnimationClip } from "../src/animation/AnimationClip";
import { AnimationChannel } from "../src/animation/AnimationChannel";
import { AnimationSampler } from "../src/animation/AnimationSampler";
import { AnimationEvents } from "../src/animation/AnimationEvents";
import { RootMotionSampler } from "../src/animation/RootMotionSampler";
const clip = new AnimationClip("walk", [
  new AnimationChannel(
    0,
    "translation",
    new AnimationSampler(
      new Float32Array([0, 1]),
      new Float32Array([0, 0, 0, 1, 0, 0]),
      "LINEAR",
    ),
  ),
]);
const root = new RootMotionSampler(clip, 0),
  out = new Float32Array(7),
  events = new AnimationEvents([clip]);
events.set(0, [
  { time: 0.2, name: "left" },
  { time: 0.8, name: "right" },
]);
let hits = 0;
events.on(() => /** Returns hits++. */ hits++);
bench("1000 root-motion deltas spanning a loop seam", () => {
  // Measures 1000 root-motion deltas spanning a loop seam.

  for (let i = 0; i < 1000; i++) root.delta(0.99, 1.01, out);
});
bench("1000 animation event crossing windows", () => {
  // Measures 1000 animation event crossing windows.

  for (let i = 0; i < 1000; i++) events.advance(0, 0.1, 0.75, true);
  if (hits < 1) throw new Error("Missing event");
});
