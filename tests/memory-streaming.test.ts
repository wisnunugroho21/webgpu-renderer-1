import { expect, it, vi } from "vitest";
import { textureMemory } from "../src/gpu/TextureMemory";
import { TextureManager } from "../src/gpu/TextureManager";
import { ResourceStats } from "../src/gpu/ResourceStats";
import { retainedMemory } from "../src/assets/retainedMemory";
import { Streaming } from "../src/assets/Streaming";

it("accounts mip chains, compressed edge blocks, layers, volumes and samples", () => {
  // Compare authored logical payloads with closed-form reference sizes.
  expect(
    textureMemory({
      size: [8, 4, 6],
      format: "rgba8unorm",
      mipLevelCount: 4,
      usage: 4,
    }).bytes,
  ).toBe((32 + 8 + 2 + 1) * 6 * 4);
  expect(
    textureMemory({
      size: [8, 8],
      format: "bc1-rgba-unorm",
      mipLevelCount: 4,
      usage: 4,
    }),
  ).toEqual({ bytes: 56, mipBytes: 24, compressedBytes: 56 });
  expect(
    textureMemory({ size: [10, 8], format: "astc-5x4-unorm", usage: 4 }).bytes,
  ).toBe(64);
  expect(
    textureMemory({
      size: [8, 8, 8],
      dimension: "3d",
      format: "r8unorm",
      mipLevelCount: 4,
      usage: 4,
    }).bytes,
  ).toBe(585);
  expect(
    textureMemory({
      size: { width: 3, height: 5 },
      format: "rgba16float",
      sampleCount: 4,
      usage: 16,
    }).bytes,
  ).toBe(480);
});
it("tracks texture ownership exactly once and deduplicates recovery backing stores", () => {
  // Releasing unknown/already retired objects must not make counters negative.
  const stats = new ResourceStats();
  const device = {
    createTexture: () => {
      /* Return a distinct mock GPU identity per allocation. */ return {
        destroy: vi.fn(),
      };
    },
  } as unknown as GPUDevice;
  const manager = new TextureManager(device, stats);
  const target = manager.create({
    size: [8, 8],
    format: "rgba16float",
    usage: 16,
  });
  const compressed = manager.create(
    { size: [8, 8], format: "bc1-rgba-unorm", mipLevelCount: 4, usage: 4 },
    "asset",
  );
  expect(stats.textureBytes).toBe(568);
  expect(stats.renderTargetBytes).toBe(512);
  expect(stats.compressedTextureBytes).toBe(56);
  expect(stats.textureMipBytes).toBe(24);
  const storageTarget = manager.create({
    size: [8, 8],
    format: "rgba32float",
    usage: 8,
  });
  expect(stats.renderTargetBytes).toBe(1536);
  manager.destroy(storageTarget);
  manager.destroy(compressed);
  manager.destroy(compressed);
  manager.dispose();
  expect(
    stats.textureBytes +
      stats.renderTargetBytes +
      stats.compressedTextureBytes +
      stats.textureMipBytes,
  ).toBe(0);
  expect(target.destroy).toHaveBeenCalledOnce();
  const data = new Uint8Array(64),
    other = new Float32Array(8);
  expect(retainedMemory({ data }, [data.subarray(8), data.buffer, other])).toBe(
    96,
  );
});
it("evicts unleased oldest residents for admission and refuses pinned pressure", async () => {
  // Budget denial must occur before a load and never destroy a live consumer's value.
  let bytes = 0;
  const manager = new Streaming<number>(
    async () => {
      /* Simulate a completed cold retirement fence. */
    },
    undefined,
    () => {
      /* Report measured owned payload. */ return {
        gpuBytes: bytes,
        recoveryBytes: bytes,
      };
    },
  );
  manager.setBudget({
    maxGPUBytes: 100,
    maxRecoveryBytes: 100,
    maxConcurrent: 1,
  });
  const destroy = (size: number) => {
    /* Release measured owned storage. */ bytes -= size;
  };
  const a = manager.acquire(
    "a",
    0,
    async () => {
      /* Allocate one mock resident. */ bytes += 60;
      return 60;
    },
    destroy,
    { estimate: { gpuBytes: 60, recoveryBytes: 60 } },
  );
  await a.ready;
  const load = vi.fn(async () => {
    /* Allocate only after admitted. */ bytes += 60;
    return 60;
  });
  const blocked = manager.acquire("b", 1, load, destroy, {
    estimate: { gpuBytes: 60 },
  });
  await expect(blocked.ready).rejects.toThrow("pinned");
  expect(load).not.toHaveBeenCalled();
  a.release();
  const b = manager.acquire("b", 2, load, destroy, {
    estimate: { gpuBytes: 60 },
  });
  await b.ready;
  expect(manager.records.has("a")).toBe(false);
  expect(bytes).toBe(60);
  b.release();
  manager.setBudget({ maxGPUBytes: 0 });
  expect(await manager.trimBudget()).toBe(1);
  expect(bytes).toBe(0);
});
it("bounds concurrent loads and prioritizes queued requests", async () => {
  // A retained active request must finish before higher-priority queued work starts.
  const manager = new Streaming<number>(async () => {
    /* Mock completed GPU work. */
  });
  manager.setBudget({ maxConcurrent: 1, maxQueued: 2 });
  let unblock!: (value: number) => void;
  const order: string[] = [];
  const first = manager.acquire(
    "first",
    0,
    () => {
      /* Hold the single admitted slot. */ order.push("first");
      return new Promise<number>((r) => {
        /* Expose controlled load completion. */ unblock = r;
      });
    },
    () => {
      /* No mock allocation to release. */
    },
  );
  await vi.waitFor(() => {
    /* Wait until the load entered its slot. */ expect(order).toEqual([
      "first",
    ]);
  });
  const low = manager.acquire(
    "low",
    0,
    async () => {
      /* Record the low-priority start. */ order.push("low");
      return 2;
    },
    () => {
      /* No storage. */
    },
  );
  const high = manager.acquire(
    "high",
    0,
    async () => {
      /* Record the high-priority start. */ order.push("high");
      return 3;
    },
    () => {
      /* No storage. */
    },
    { priority: 10 },
  );
  const excess = manager.acquire(
    "excess",
    0,
    async () => {
      /* Must never enter a full queue. */ throw new Error("unexpected start");
    },
    () => {
      /* No storage. */
    },
  );
  await expect(excess.ready).rejects.toThrow("queue capacity");
  unblock(1);
  await Promise.all([first.ready, high.ready, low.ready]);
  expect(order).toEqual(["first", "high", "low"]);
  expect(manager.diagnostics.reserved.gpuBytes).toBe(0);
});
it("rolls back underestimated loads and retains failed cleanup for a retry", async () => {
  // Unexpected actual cost cannot publish a value or silently discard cleanup ownership.
  let bytes = 0,
    fail = false;
  const manager = new Streaming<number>(
    async () => {
      /* Complete fence. */
    },
    undefined,
    () => {
      /* Include live mock allocation. */ return {
        gpuBytes: bytes,
        recoveryBytes: 0,
      };
    },
  );
  manager.setBudget({ maxGPUBytes: 10 });
  const destroy = () => {
    /* Simulate a retryable cleanup failure. */ if (fail)
      throw new Error("cleanup");
    bytes = 0;
  };
  const load = async () => {
    /* Deliberately under-estimated allocation. */ bytes = 20;
    return 20;
  };
  const a = manager.acquire("a", 0, load, destroy);
  await expect(a.ready).rejects.toThrow("Actual");
  expect(bytes).toBe(0);
  fail = true;
  const b = manager.acquire("b", 0, load, destroy);
  await expect(b.ready).rejects.toThrow("rollback");
  b.release();
  expect(manager.records.get("b")?.value).toBe(20);
  fail = false;
  expect(await manager.trimBudget()).toBe(1);
  expect(bytes).toBe(0);
});

it("validates controls and refuses reacquisition during asynchronous retirement", async () => {
  // Invalid configuration stays atomic; destroyed GPU objects can never escape through a new lease.
  const unmeasured = new Streaming<number>(async () => {
    /* Completed work. */
  });
  expect(() => {
    /* Byte limits require actual owned-memory accounting. */ unmeasured.setBudget(
      { maxGPUBytes: 10 },
    );
  }).toThrow("provider");
  expect(() => {
    /* Queue limits cannot disable all progress. */ unmeasured.setBudget({
      maxConcurrent: 0,
    });
  }).toThrow();
  expect(unmeasured.diagnostics.budget).toBeUndefined();
  let bytes = 1,
    finish!: () => void;
  const manager = new Streaming<number>(
    async () => {
      /* Completed work. */
    },
    undefined,
    () => {
      /* Report resident mock payload. */ return {
        gpuBytes: bytes,
        recoveryBytes: 0,
      };
    },
  );
  manager.setBudget({ maxGPUBytes: 1 });
  const a = manager.acquire(
    "a",
    0,
    async () => {
      /* Publish resident mock identity. */ return 1;
    },
    () => {
      /* Hold retirement across a reacquisition attempt. */ return new Promise<void>(
        (resolve) => {
          /* Complete only when the test releases destruction. */ finish =
            () => {
              /* Remove the owned payload before signaling completion. */ bytes = 0;
              resolve();
            };
        },
      );
    },
  );
  await a.ready;
  a.release();
  manager.setBudget({ maxGPUBytes: 0 });
  const trim = manager.trimBudget();
  await vi.waitFor(() => {
    /* Wait until asynchronous destruction owns the key. */ expect(
      finish,
    ).toBeTypeOf("function");
  });
  expect(() => {
    /* No lease can expose an object currently being destroyed. */ manager.acquire(
      "a",
      1,
      async () => {
        /* Must never execute. */ return 2;
      },
      () => {
        /* No allocation. */
      },
    );
  }).toThrow("retiring");
  finish();
  expect(await trim).toBe(1);
  expect(manager.records.size).toBe(0);
});
