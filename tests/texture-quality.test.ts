import { expect, it, vi } from "vitest";
import {
  TextureQualityStreaming,
  type TextureQualityHost,
} from "../src/rendering/TextureQualityStreaming";
import { Camera } from "../src/rendering/Camera";
import { RenderQueue } from "../src/rendering/RenderQueue";
import { RenderWorld } from "../src/rendering/RenderWorld";
import type { RuntimeAsset } from "../src/assets/gltf/RuntimeAsset";
/** Create one projected sphere and an injectable cold streaming host. */
function fixture() {
  const world = new RenderWorld(1),
    queue = new RenderQueue(1),
    camera = new Camera();
  world.count = queue.count = 1;
  world.sphere.set([0, 0, 0, 1]);
  camera.setPosition(0, 0, 5);
  camera.setTarget(0, 0, 0);
  camera.setOrthographic({ height: 4 });
  camera.update(1);
  const memory = { gpuBytes: 0, recoveryBytes: 0 };
  const host: TextureQualityHost = {
    qualityGeneration: () => {
      /* Return a stable live mock material identity. */ return 1;
    },
    replaceMaterial: vi.fn(async () => {
      // Stand in for successful atomic publication.
      return true;
    }),
    releaseMaterial: vi.fn(),
    trimBudget: vi.fn(async () => {
      // Simulate completed cold eviction.
      return 0;
    }),
    qualityMemory: vi.fn(() => {
      // Keep memory snapshots off the observation path.
      return { memory, reserved: { gpuBytes: 0, recoveryBytes: 0 } };
    }),
  };
  const quality = new TextureQualityStreaming(host, 4);
  quality.enabled = true;
  quality.intervalFrames = 1;
  const tiers = [
    {
      key: "medium",
      minPixels: 20,
      estimate: { gpuBytes: 20, recoveryBytes: 20 },
      load: async () => {
        // Host mocks do not inspect decoded GPU assets.
        return {} as RuntimeAsset;
      },
    },
    {
      key: "high",
      minPixels: 40,
      estimate: { gpuBytes: 40, recoveryBytes: 40 },
      load: async () => {
        // Higher authored quality retains an independent loader.
        return {} as RuntimeAsset;
      },
    },
  ];
  quality.register(0, tiers);
  return { quality, host, world, queue, camera, tiers, memory };
}
it("selects authored tiers automatically with hysteresis and no hot memory/loading work", async () => {
  // Observation only schedules a microtask; host calls must occur after it completes.
  const f = fixture();
  f.quality.update(f.world, f.queue, f.camera, 100, 0);
  expect(f.host.replaceMaterial).not.toHaveBeenCalled();
  expect(f.host.qualityMemory).not.toHaveBeenCalled();
  await f.quality.wait();
  expect(f.quality.status(0)?.currentTier).toBe(2);
  f.quality.update(f.world, f.queue, f.camera, 72, 1);
  await f.quality.wait();
  expect(f.quality.status(0)?.currentTier).toBe(2);
  f.quality.update(f.world, f.queue, f.camera, 60, 2);
  await f.quality.wait();
  expect(f.quality.status(0)?.currentTier).toBe(1);
  expect(f.host.replaceMaterial).toHaveBeenCalledTimes(2);
});
it("restores the fallback for invisible geometry and never loads while disabled", async () => {
  // Offscreen GPU-indirect candidates still receive a conservative CPU side-plane check.
  const f = fixture();
  f.quality.update(f.world, f.queue, f.camera, 100, 0);
  await f.quality.wait();
  f.world.sphere[0] = 100;
  f.quality.update(f.world, f.queue, f.camera, 100, 1);
  await f.quality.wait();
  expect(f.quality.status(0)?.currentTier).toBe(0);
  expect(f.host.releaseMaterial).toHaveBeenCalledWith(0);
  f.quality.enabled = false;
  f.world.sphere[0] = 0;
  f.quality.update(f.world, f.queue, f.camera, 100, 2);
  await f.quality.wait();
  expect(f.host.replaceMaterial).toHaveBeenCalledTimes(1);
});
it("adapts to budget pressure and leaves pinned fixed memory outside quality admission", async () => {
  // Current high residency must release before a lower tier can be admitted under reduced limits.
  const f = fixture();
  f.quality.update(f.world, f.queue, f.camera, 100, 0);
  await f.quality.wait();
  const memory = { gpuBytes: 100, recoveryBytes: 100 },
    budget = {
      maxGPUBytes: 50,
      maxRecoveryBytes: 50,
      maxConcurrent: 1,
      maxQueued: 16,
    };
  f.host.qualityMemory = () => {
    // Report pressure from a budget edit at a cold boundary.
    return { memory, reserved: { gpuBytes: 0, recoveryBytes: 0 }, budget };
  };
  f.host.trimBudget = async () => {
    // Reclaim high-quality payload only after its live material lease is released.
    if (vi.mocked(f.host.releaseMaterial).mock.calls.length)
      memory.gpuBytes = memory.recoveryBytes = 30;
    return 1;
  };
  f.quality.update(f.world, f.queue, f.camera, 100, 1);
  await f.quality.wait();
  expect(f.host.releaseMaterial).toHaveBeenCalledWith(0);
  expect(f.quality.status(0)?.currentTier).toBe(1);
});
it("reports loader failures and retains the prior material until a successful retry", async () => {
  // Expected runtime failures are observable and do not replace working residency.
  const f = fixture();
  f.host.replaceMaterial = vi.fn(async () => {
    // Surface a controlled decode error.
    throw new Error("decode failed");
  });
  f.quality.update(f.world, f.queue, f.camera, 100, 0);
  await f.quality.wait();
  expect(f.quality.failures).toBe(1);
  expect(f.quality.status(0)?.lastError).toBeInstanceOf(Error);
  expect(f.quality.status(0)?.currentTier).toBe(0);
  expect(f.host.releaseMaterial).not.toHaveBeenCalled();
});
it("drains earlier concurrent work before suspend and preserves profiles through resume", async () => {
  // Later sweeps must not overwrite the promise tracking an already pending tier.
  const f = fixture();
  let finish!: (value: boolean) => void;
  f.host.replaceMaterial = () => {
    // Hold publication until the recovery boundary explicitly completes it.
    return new Promise((resolve) => {
      // Capture the diagnostic host completion without GPU resources.
      finish = resolve;
    });
  };
  f.quality.update(f.world, f.queue, f.camera, 100, 0);
  await Promise.resolve();
  f.quality.update(f.world, f.queue, f.camera, 100, 1);
  await Promise.resolve();
  let complete = false;
  const pending = f.quality.suspend().then(() => {
    // Signal a fully drained recovery boundary.
    complete = true;
  });
  await Promise.resolve();
  expect(complete).toBe(false);
  finish(true);
  await pending;
  expect(complete).toBe(true);
  f.quality.resume();
  expect(f.quality.status(0)?.currentTier).toBe(2);
  f.quality.dispose();
  expect(f.quality.status(0)).toBeUndefined();
});
it("copies and validates tier metadata before registration", () => {
  // A caller cannot later change the immutable byte admission contract.
  const f = fixture();
  f.tiers[0]!.estimate.gpuBytes = 100000;
  expect(() => {
    // Re-registering an already managed material is rejected transactionally.
    f.quality.register(0, f.tiers);
  }).toThrow();
  expect(() => {
    // Nonmonotonic projected thresholds cannot produce a deterministic quality ladder.
    f.quality.register(1, [f.tiers[1]!, f.tiers[0]!]);
  }).toThrow();
});

it("retires quality profiles when a numeric material slot is recycled", async () => {
  // A new material must not inherit loaders registered for its previous lifetime.
  const f = fixture();
  f.quality.update(f.world, f.queue, f.camera, 100, 0);
  await f.quality.wait();
  f.host.qualityGeneration = () => {
    /* Identify a recycled material lifetime. */ return 2;
  };
  f.quality.update(f.world, f.queue, f.camera, 100, 1);
  await f.quality.wait();
  expect(f.quality.status(0)).toBeUndefined();
  expect(f.host.replaceMaterial).toHaveBeenCalledTimes(1);
  expect(f.host.releaseMaterial).toHaveBeenCalledWith(0);
});
