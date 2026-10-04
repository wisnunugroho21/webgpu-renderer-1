import { describe, bench } from "vitest";
import { CPUProfiler } from "../src/profiling/CPUProfiler";
const profiler = new CPUProfiler();
describe("profiling overhead", () => {
  // Groups checks for profiling overhead.

  bench("record 9 CPU stages x 10,000 frames", () => {
    // Measures record 9 CPU stages x 10,000 frames.

    for (let frame = 0; frame < 10000; frame++) {
      profiler.beginFrame();
      for (let stage = 0; stage < 9; stage++) {
        profiler.start(stage);
        profiler.end(stage);
      }
      profiler.finishFrame();
    }
  });
});
