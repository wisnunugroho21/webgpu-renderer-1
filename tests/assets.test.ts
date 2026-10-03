import { it, expect, vi } from "vitest";
import { AssetLoader } from "../src/assets/AssetLoader";
it("exposes all states, yields between stages, and deduplicates concurrent/cached requests", async () => {
  let release!: (value: number) => void;
  const network = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        release = resolve;
      }),
  );
  const decode = vi.fn(async (value: number) => value + 1),
    upload = vi.fn(async (value: number) => value * 2);
  const yieldTask = vi.fn(async () => {}),
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
  for (let stage = 0; stage < 3; stage++) {
    let fail = true;
    const action = (i: number) => async (value: unknown) => {
      if (fail && stage === i) throw new Error("failed");
      return value;
    };
    const loader = new AssetLoader(
      action(0),
      action(1),
      action(2),
      async () => {},
    );
    await expect(loader.load("a")).rejects.toThrow("failed");
    expect(loader.get("a").state).toBe("Failed");
    expect(loader.get("a").pending).toBeUndefined();
    fail = false;
    await loader.load("a");
    expect(loader.get("a").state).toBe("Ready");
  }
});
