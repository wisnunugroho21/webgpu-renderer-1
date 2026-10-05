import { bench } from "vitest";
import { textureMemory } from "../src/gpu/TextureMemory";
import { retainedMemory } from "../src/assets/retainedMemory";
import { Streaming } from "../src/assets/Streaming";
const descriptor: GPUTextureDescriptor = {
  size: [4096, 4096, 6],
  format: "bc7-rgba-unorm",
  mipLevelCount: 13,
  usage: 4,
};
bench("account 1000 compressed cube mip chains", () => {
  // Measure cold descriptor accounting, never production per-frame work.
  for (let i = 0; i < 1000; i++) textureMemory(descriptor);
});
const sources = Array.from({ length: 1000 }, () => {
  // Allocate recovery fixtures once; each asset's views share one backing store.
  const data = new Uint8Array(4096);
  return { data, positions: data.subarray(0, 1024), alias: data.buffer };
});
bench("snapshot 1000 aliased recovery stores", () => {
  // Walk object metadata and backing-store identities without reading payload contents.
  retainedMemory(sources, sources);
});
bench("admit and pressure-evict 100 streamed resources", async () => {
  // Include opt-in scheduling and residency reconciliation with a completed mock cold GPU fence.
  let bytes = 0;
  const manager = new Streaming<number>(
    async () => {
      /* Completed mock work. */
    },
    undefined,
    () => {
      /* Report actual mock allocation ledger. */ return {
        gpuBytes: bytes,
        recoveryBytes: bytes,
      };
    },
  );
  manager.setBudget({
    maxGPUBytes: 4096,
    maxRecoveryBytes: 4096,
    maxConcurrent: 1,
  });
  for (let i = 0; i < 100; i++) {
    const lease = manager.acquire(
      String(i),
      i,
      async () => {
        /* Allocate only after budget admission. */ bytes += 1024;
        return 1024;
      },
      (size) => {
        /* Retire the owned payload. */ bytes -= size;
      },
      { estimate: { gpuBytes: 1024, recoveryBytes: 1024 } },
    );
    await lease.ready;
    lease.release();
  }
  manager.setBudget({ maxGPUBytes: 0 });
  await manager.trimBudget();
});
