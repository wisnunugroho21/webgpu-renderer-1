import { bench } from "vitest";
import { TemporalVisibility } from "../src/rendering/visibility/TemporalVisibility";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { Camera } from "../src/rendering/Camera";
const w = new RenderWorld(100000),
  camera = new Camera(),
  temporal = new TemporalVisibility(w);
w.count = 100000;
camera.update(1);
temporal.enabled = true;
for (let i = 0; i < w.count; i++) w.entityId[i] = i;
temporal.prepare(w, camera, 0, 1280, 960, true);
bench("compare exact temporal snapshots for 100000 objects", () =>
  temporal.prepare(w, camera, 0, 1280, 960, true),
);
