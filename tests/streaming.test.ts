import { it, expect, vi } from "vitest";
import { Streaming } from "../src/assets/Streaming";
it("protects leases, coalesces loading, fences eviction, and rechecks reacquisition", async () => {
  let fence!: () => void;
  const workDone = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        fence = resolve;
      }),
  );
  const manager = new Streaming<number>(workDone),
    load = vi.fn(async () => 7),
    destroy = vi.fn();
  const a = manager.acquire("mesh", 1, load, destroy),
    b = manager.acquire("mesh", 1, load, destroy);
  expect(await a.ready).toBe(7);
  await b.ready;
  expect(load).toHaveBeenCalledTimes(1);
  a.release();
  a.release();
  expect(await manager.evictUnused(100, 1)).toBe(0);
  b.release();
  const pending = manager.evictUnused(100, 1);
  expect(destroy).not.toHaveBeenCalled();
  const c = manager.acquire("mesh", 100, load, destroy);
  fence();
  expect(await pending).toBe(0);
  c.touch(101);
  c.release();
  expect(await manager.evictUnused(101, 1)).toBe(0);
  const eviction = manager.evictUnused(102, 1);
  fence();
  expect(await eviction).toBe(1);
  expect(destroy).toHaveBeenCalledWith(7);
  expect(manager.records.size).toBe(0);
});
it("does not evict pending loads and removes failed entries for retry", async () => {
  const manager = new Streaming<number>(async () => {});
  let resolve!: (value: number) => void;
  const lease = manager.acquire(
    "a",
    0,
    () =>
      new Promise<number>((r) => {
        resolve = r;
      }),
    () => {},
  );
  lease.release();
  expect(await manager.evictUnused(100, 1)).toBe(0);
  resolve(3);
  await lease.ready;
  expect(await manager.evictUnused(100, 1)).toBe(1);
  const failed = manager.acquire(
    "b",
    0,
    async () => {
      throw new Error("failed");
    },
    () => {},
  );
  await expect(failed.ready).rejects.toThrow("failed");
  expect(manager.records.size).toBe(0);
});
it("retains unleased resources still referenced by a render snapshot", async () => {
  let referenced = true;
  const destroy = vi.fn(),
    manager = new Streaming<number>(
      async () => {},
      () => referenced,
    );
  const lease = manager.acquire("a", 0, async () => 1, destroy);
  await lease.ready;
  lease.release();
  expect(await manager.evictUnused(100, 1)).toBe(0);
  referenced = false;
  expect(await manager.evictUnused(100, 1)).toBe(1);
});
