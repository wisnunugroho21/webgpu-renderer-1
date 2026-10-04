import { it, expect, vi } from "vitest";
import { AssetLoader } from "../src/assets/AssetLoader";
it("exposes all states, yields between stages, and deduplicates concurrent/cached requests", async () => {
  // Verifies exposes all states, yields between stages, and deduplicates concurrent/cached requests.

  let release!: (value: number) => void;
  const network = vi.fn(
    () =>
      /** Creates Promise storage for this operation. */ new Promise<number>(
        (resolve) => {
          // Updates release for this callback.

          release = resolve;
        },
      ),
  );
  const decode = vi.fn(
      async (value: number) => /** Computes the value + 1 result. */ value + 1,
    ),
    upload = vi.fn(
      async (value: number) => /** Computes the value * 2 result. */ value * 2,
    );
  const yieldTask = vi.fn(async () => {
      // Intentionally performs no work at this optional callback boundary.
    }),
    loader = new AssetLoader(network, decode, upload, yieldTask);
  expect(loader.get("a").state).toBe("Unloaded");
  const first = loader.load("a"),
    second = loader.load("a");
  expect(first).toBe(second);
  expect(loader.get("a").state).toBe("Loading");
  await Promise.resolve();
  release(2);
  expect(await first).toBe(6);
  expect(loader.get("a").history).toEqual([
    "Unloaded",
    "Loading",
    "Decoded",
    "Uploading",
    "Ready",
  ]);
  expect(await loader.load("a")).toBe(6);
  expect(network).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(yieldTask).toHaveBeenCalledTimes(2);
});
it("records network, decode and upload failures and permits retries", async () => {
  // Verifies records network, decode and upload failures and permits retries.

  for (let stage = 0; stage < 3; stage++) {
    let fail = true;
    /** Returns async (value: unknown) => { if (fail && stage === i) throw new Error("failed"); return value; }. */
    const action = (i: number) => async (value: unknown) => {
      // Verifies records network, decode and upload failures and permits retries.

      if (fail && stage === i) throw new Error("failed");
      return value;
    };
    const loader = new AssetLoader(
      action(0),
      action(1),
      action(2),
      async () => {
        // Intentionally performs no work at this optional callback boundary.
      },
    );
    await expect(loader.load("a")).rejects.toThrow("failed");
    expect(loader.get("a").state).toBe("Failed");
    expect(loader.get("a").pending).toBeUndefined();
    fail = false;
    await loader.load("a");
    expect(loader.get("a").state).toBe("Ready");
  }
});
it("cancels a shared fetch with a signal, releases decoded data, and retries", async () => {
  // Verifies cancels a shared fetch with a signal, releases decoded data, and retries.

  let signal!: AbortSignal;
  const network = vi.fn(
    (_url: string, s: AbortSignal) =>
      /** Creates Promise storage for this operation. */ new Promise<number>(
        (_resolve, reject) => {
          // Applies s.addEventListener to the current callback state.

          signal = s;
          s.addEventListener(
            "abort",
            () =>
              /** Handles the abort event for assets.test.ts. */ reject(
                s.reason,
              ),
            { once: true },
          );
        },
      ),
  );
  const decode = vi.fn(async (n: number) => /** Returns n. */ n),
    upload = vi.fn(async (n: number) => /** Returns n. */ n);
  const loader = new AssetLoader(network, decode, upload, async () => {
    // Intentionally performs no work at this optional callback boundary.
  });
  const pending = loader.load("a");
  await Promise.resolve();
  expect(loader.cancel("a")).toBe(true);
  expect(signal.aborted).toBe(true);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(decode).not.toHaveBeenCalled();
  expect(loader.get("a").state).toBe("Cancelled");
  network.mockImplementation(async () => /** Returns 3. */ 3);
  expect(await loader.load("a")).toBe(3);
});
it("cleans a late successful upload after cancellation and blocks reload until unload finishes", async () => {
  // Verifies cleans a late successful upload after cancellation and blocks reload until unload finishes.

  let resolve!: (n: number) => void;
  const release = vi.fn(async () => {
    // Intentionally performs no work at this optional callback boundary.
  });
  const loader = new AssetLoader(
    async () =>
      /** Verifies cleans a late successful upload after cancellation and blocks reload until unload finishes. */ 1,
    async (n) =>
      /** Verifies cleans a late successful upload after cancellation and blocks reload until unload finishes. */ n,
    () =>
      /** Verifies cleans a late successful upload after cancellation and blocks reload until unload finishes. */ new Promise<number>(
        (r) => {
          // Verifies cleans a late successful upload after cancellation and blocks reload until unload finishes.

          resolve = r;
        },
      ),
    async () => {
      // Intentionally performs no work at this optional callback boundary.
    },
    { release },
  );
  const pending = loader.load("a");
  await vi.waitFor(() =>
    /** Delegates this operation to expect(loader.get("a").state).toBe. */ expect(
      loader.get("a").state,
    ).toBe("Uploading"),
  );
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  const unload = loader.unload("a");
  await expect(loader.load("a")).rejects.toThrow("unloading");
  resolve(7);
  await rejected;
  await unload;
  expect(release).toHaveBeenCalledExactlyOnceWith(7);
  expect(loader.records.size).toBe(0);
});
it("evicts LRU unretained records by decoded bytes and record count while protecting live leases", async () => {
  // Verifies evicts LRU unretained records by decoded bytes and record count while protecting live leases.

  const release = vi.fn(async () => {
    // Intentionally performs no work at this optional callback boundary.
  });
  const loader = new AssetLoader(
    async (url) =>
      /** Verifies evicts LRU unretained records by decoded bytes and record count while protecting live leases. */ url,
    async (s) =>
      /** Verifies evicts LRU unretained records by decoded bytes and record count while protecting live leases. */ s,
    async (s) =>
      /** Verifies evicts LRU unretained records by decoded bytes and record count while protecting live leases. */ s,
    async () => {
      // Intentionally performs no work at this optional callback boundary.
    },
    {
      /** Returns 8. */
      decodedBytes: () => 8,
      release,
      budget: { maxRecords: 3, maxDecodedBytes: 16 },
    },
  );
  const unpin = loader.retain("a");
  await loader.load("a");
  await loader.load("b");
  await loader.load("c");
  expect(Array.from(loader.records.keys())).toEqual(["a", "c"]);
  expect(release).toHaveBeenCalledWith("b");
  unpin();
  unpin();
  expect(
    await loader.setCacheBudget({ maxRecords: 0, maxDecodedBytes: 0 }),
  ).toBe(2);
  expect(loader.records.size).toBe(0);
  expect(loader.cachedDecodedBytes).toBe(0);
});
it("honors unload vetoes without changing a ready asset and disposes all successful loads", async () => {
  // Verifies honors unload vetoes without changing a ready asset and disposes all successful loads.

  let veto = true;
  const release = vi.fn(async () => {
    // Intentionally performs no work at this optional callback boundary.
  });
  const loader = new AssetLoader(
    async () =>
      /** Verifies honors unload vetoes without changing a ready asset and disposes all successful loads. */ 1,
    async (n) =>
      /** Verifies honors unload vetoes without changing a ready asset and disposes all successful loads. */ n,
    async (n) =>
      /** Verifies honors unload vetoes without changing a ready asset and disposes all successful loads. */ n,
    async () => {
      // Intentionally performs no work at this optional callback boundary.
    },
    {
      release,
      /** Rejects invalid input for before unload. */
      beforeUnload: () => {
        if (veto) throw new Error("in use");
      },
    },
  );
  await loader.load("a");
  await expect(loader.unload("a")).rejects.toThrow("in use");
  expect(loader.get("a").state).toBe("Ready");
  expect(release).not.toHaveBeenCalled();
  veto = false;
  await loader.dispose();
  expect(release).toHaveBeenCalledOnce();
  expect(loader.records.size).toBe(0);
  await expect(loader.load("b")).rejects.toThrow("disposed");
});
it("prevents decode/upload after cancellation at a yield boundary", async () => {
  // Verifies prevents decode/upload after cancellation at a yield boundary.

  let resume!: () => void;
  const decode = vi.fn(async (n: number) => /** Returns n. */ n),
    upload = vi.fn(async (n: number) => /** Returns n. */ n);
  const loader = new AssetLoader(
    async () =>
      /** Verifies prevents decode/upload after cancellation at a yield boundary. */ 1,
    decode,
    upload,
    () =>
      /** Verifies prevents decode/upload after cancellation at a yield boundary. */ new Promise<void>(
        (r) => {
          // Verifies prevents decode/upload after cancellation at a yield boundary.

          resume = r;
        },
      ),
  );
  const pending = loader.load("a");
  await vi.waitFor(() =>
    /** Delegates this operation to expect(resume).toBeTypeOf. */ expect(
      resume,
    ).toBeTypeOf("function"),
  );
  loader.cancel("a");
  resume();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(decode).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
});
it("retains cleanup ownership after a release failure and requires unload before retry", async () => {
  // Verifies retains cleanup ownership after a release failure and requires unload before retry.

  let finish!: (value: number) => void,
    failCleanup = true;
  const release = vi.fn(async () => {
    // Rejects invalid input for the current operation.

    if (failCleanup) throw new Error("cleanup failure");
  });
  const loader = new AssetLoader(
    async () =>
      /** Verifies retains cleanup ownership after a release failure and requires unload before retry. */ 1,
    async (n) =>
      /** Verifies retains cleanup ownership after a release failure and requires unload before retry. */ n,
    () =>
      /** Verifies retains cleanup ownership after a release failure and requires unload before retry. */ new Promise<number>(
        (resolve) => {
          // Verifies retains cleanup ownership after a release failure and requires unload before retry.

          finish = resolve;
        },
      ),
    async () => {
      // Intentionally performs no work at this optional callback boundary.
    },
    { release },
  );
  const pending = loader.load("a");
  await vi.waitFor(() =>
    /** Delegates this operation to expect(loader.get("a").state).toBe. */ expect(
      loader.get("a").state,
    ).toBe("Uploading"),
  );
  loader.cancel("a");
  finish(7);
  await expect(pending).rejects.toThrow("load and cleanup failed");
  expect(loader.get("a").uploaded).toBe(7);
  await expect(loader.load("a")).rejects.toThrow("cleanup required");
  failCleanup = false;
  await loader.unload("a");
  expect(release).toHaveBeenCalledTimes(2);
  expect(loader.records.size).toBe(0);
});
it("disposal aborts a pending network operation and clears its record", async () => {
  // Verifies disposal aborts a pending network operation and clears its record.

  const loader = new AssetLoader(
    (_url, signal) =>
      /** Verifies disposal aborts a pending network operation and clears its record. */ new Promise<number>(
        (_resolve, reject) => {
          // Verifies disposal aborts a pending network operation and clears its record.

          signal.addEventListener(
            "abort",
            () =>
              /** Handles the abort event for assets.test.ts. */ reject(
                signal.reason,
              ),
            {
              once: true,
            },
          );
        },
      ),
    async (n) =>
      /** Verifies disposal aborts a pending network operation and clears its record. */ n,
    async (n) =>
      /** Verifies disposal aborts a pending network operation and clears its record. */ n,
    async () => {
      // Intentionally performs no work at this optional callback boundary.
    },
  );
  const pending = loader.load("a"),
    rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  await loader.dispose();
  await rejected;
  expect(loader.records.size).toBe(0);
});
it("shares concurrent unloads and retains ownership when release must be retried", async () => {
  // Verifies shares concurrent unloads and retains ownership when release must be retried.

  let fail = true;
  const release = vi.fn(async () => {
    // Rejects invalid input for the current operation.

    if (fail) throw new Error("release failed");
  });
  const loader = new AssetLoader(
    async () =>
      /** Verifies shares concurrent unloads and retains ownership when release must be retried. */ 1,
    async (n) =>
      /** Verifies shares concurrent unloads and retains ownership when release must be retried. */ n,
    async (n) =>
      /** Verifies shares concurrent unloads and retains ownership when release must be retried. */ n,
    async () => {
      // Intentionally performs no work at this optional callback boundary.
    },
    { release },
  );
  await loader.load("a");
  const a = loader.unload("a"),
    b = loader.unload("a");
  expect(a).toBe(b);
  await expect(a).rejects.toThrow("release failed");
  expect(loader.get("a").uploaded).toBe(1);
  await expect(loader.load("a")).rejects.toThrow("cleanup required");
  fail = false;
  await loader.unload("a");
  expect(loader.records.size).toBe(0);
});
it("bounds failed-request metadata without discarding pending or retained records", async () => {
  // Verifies bounds failed-request metadata without discarding pending or retained records.

  const loader = new AssetLoader(
    async () => {
      // Verifies bounds failed-request metadata without discarding pending or retained records.

      throw new Error("network failed");
    },
    async (n: number) =>
      /** Verifies bounds failed-request metadata without discarding pending or retained records. */ n,
    async (n) =>
      /** Verifies bounds failed-request metadata without discarding pending or retained records. */ n,
    async () => {
      // Intentionally performs no work at this optional callback boundary.
    },
    { budget: { maxRecords: 4 } },
  );
  const release = loader.retain("live");
  for (let i = 0; i < 20; i++)
    await expect(loader.load(String(i))).rejects.toThrow("network failed");
  expect(loader.records.size).toBe(4);
  expect(loader.records.has("live")).toBe(true);
  release();
  await loader.dispose();
});
