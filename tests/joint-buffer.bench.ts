import { bench, describe } from "vitest";
import { JointMatrixBuffer } from "../src/rendering/JointMatrixBuffer";
import { BufferManager } from "../src/gpu/BufferManager";
import { RenderWorld } from "../src/rendering/RenderWorld";
Object.assign(globalThis, {
  GPUBufferUsage: { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4 },
});
const world = new RenderWorld(1, 6400);
world.jointCount = 6400;
const palette = new JointMatrixBuffer(
    { create: () => ({}) } as unknown as BufferManager,
    6400,
  ),
  queue = { writeBuffer: () => {} } as unknown as GPUQueue;
describe("Phase 19 6,400 joints CPU dirty-range staging (mock queue)", () => {
  bench("unchanged ranges", () => palette.upload(queue, world));
  bench("all joints changed", () => {
    world.jointDirty.fill(1);
    palette.upload(queue, world);
  });
  bench("100 sparse changes", () => {
    for (let j = 0; j < 6400; j += 64) world.jointDirty[j] = 1;
    palette.upload(queue, world);
  });
});
