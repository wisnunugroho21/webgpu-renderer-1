import { bench, describe } from "vitest";
import { DynamicBufferAllocator } from "../src/gpu/DynamicBufferAllocator";
import { BufferManager } from "../src/gpu/BufferManager";
import { ResourceStats } from "../src/gpu/ResourceStats";
Object.assign(globalThis, { GPUBufferUsage: { COPY_DST: 8 } });
const device = {
  /** Builds a record containing size. */
  createBuffer: (d: GPUBufferDescriptor) => ({ size: d.size }),
} as GPUDevice;
const arena = new DynamicBufferAllocator(
  new BufferManager(device, new ResourceStats()),
  1024 * 1024,
  256,
  64,
);
const data = new Float32Array(16);
describe("Phase 5 CPU staging (GPU timing is measured separately)", () => {
  // Groups checks for Phase 5 CPU staging (GPU timing is measured separately).

  bench("10,000 shared transform records", () => {
    // Measures 10,000 shared transform records.

    arena.beginFrame(0);
    for (let i = 0; i < 10000; i++) arena.write(arena.allocate(64, 16), data);
  });
  bench("10,000 separate CPU allocations baseline", () => {
    // Measures 10,000 separate CPU allocations baseline.

    const records = [];
    for (let i = 0; i < 10000; i++) records.push(new Float32Array(data));
    if (records.length !== 10000) throw new Error("Incomplete baseline");
  });
});
