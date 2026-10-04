import { bench } from "vitest";
import { AssetLoader } from "../src/assets/AssetLoader";
import { RangeAllocator } from "../src/assets/RangeAllocator";
bench(
  "load/unload 100 decoded assets with a 16-record LRU budget",
  async () => {
    // Measures load/unload 100 decoded assets with a 16-record LRU budget.

    let resident = 0;
    const loader = new AssetLoader(
      async () =>
        /** Measures load/unload 100 decoded assets with a 16-record LRU budget. */ new Uint8Array(
          1024,
        ),
      async (data) =>
        /** Measures load/unload 100 decoded assets with a 16-record LRU budget. */ data,
      async () =>
        /** Measures load/unload 100 decoded assets with a 16-record LRU budget. */ ++resident,
      async () => {
        // Intentionally performs no work at this optional callback boundary.
      },
      {
        /** Returns data byte length. */
        decodedBytes: (data) => data.byteLength,
        budget: { maxRecords: 16, maxDecodedBytes: 16384 },
        /** Provides the controlled callback used by load/unload 100 decoded assets with a 16-record LRU budget. */
        release: async () => {
          resident--;
        },
      },
    );
    for (let i = 0; i < 100; i++) await loader.load(String(i));
    if (loader.records.size !== 16 || resident !== 16)
      throw new Error("Cache budget mismatch");
    await loader.dispose();
    if (Number(resident) !== 0 || Number(loader.records.size) !== 0)
      throw new Error("Leaked asset");
  },
);
bench("allocate/release 1000 fragmented shared arena ranges", () => {
  // Measures allocate/release 1000 fragmented shared arena ranges.

  const arena = new RangeAllocator(64000),
    offsets: number[] = [];
  for (let i = 0; i < 1000; i++) offsets.push(arena.allocate(64));
  for (let i = 0; i < 1000; i += 2) arena.release(offsets[i]!);
  for (let i = 0; i < 1000; i += 2) offsets[i] = arena.allocate(64);
  for (const offset of offsets) arena.release(offset);
  if (arena.count !== 0) throw new Error("Leaked range");
});
