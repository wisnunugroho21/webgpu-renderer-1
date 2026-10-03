import { bench, describe } from "vitest";
import { MorphStatePool } from "../src/animation/MorphStatePool";
import { MorphTargetData } from "../src/animation/MorphTargetData";
const targets = Array.from({ length: 4 }, () => ({
  POSITION: new Float32Array(30000),
  NORMAL: new Float32Array(30000),
  TANGENT: new Float32Array(30000),
}));
describe("Phase 21 morph data preparation", () => {
  bench("validate 4 targets x 10,000 vertices, all three streams", () => {
    new MorphTargetData(targets, 10000);
  });
  bench("allocate 1,000 independent four-weight states", () => {
    const p = new MorphStatePool(4000);
    for (let i = 0; i < 1000; i++) p.create(4, [0, 0, 0, 0]);
  });
});

import { MorphWeightBuffer } from "../src/rendering/MorphWeightBuffer";
import { BufferManager } from "../src/gpu/BufferManager";
import { RenderWorld } from "../src/rendering/RenderWorld";
Object.assign(globalThis, {
  GPUBufferUsage: { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4 },
});
const weightsWorld = new RenderWorld(1, 1, 4000);
weightsWorld.morphWeightCount = 4000;
const weightBuffer = new MorphWeightBuffer(
    { create: () => ({}) } as unknown as BufferManager,
    4000,
  ),
  queue = { writeBuffer: () => {} } as unknown as GPUQueue;
describe("Phase 22 morph weight CPU staging (mock queue)", () => {
  bench("4,000 unchanged weights", () =>
    weightBuffer.upload(queue, weightsWorld),
  );
  bench("4,000 changed weights", () => {
    weightsWorld.morphDirty.fill(1);
    weightBuffer.upload(queue, weightsWorld);
  });
});
