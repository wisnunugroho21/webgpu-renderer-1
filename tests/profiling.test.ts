import { describe, it, expect, vi } from "vitest";
import { CPUProfiler, CPUStage } from "../src/profiling/CPUProfiler";
import { GPUProfiler } from "../src/profiling/GPUProfiler";
import { Resources } from "../src/gpu/Resources";
describe("profiling", () => {
  it("records stages in a bounded ring without replacing arrays", () => {
    let now = 0;
    const profiler = new CPUProfiler(2, () => now),
      history = profiler.history;
    for (let i = 0; i < 3; i++) {
      profiler.beginFrame();
      profiler.start(CPUStage.animation);
      now += 2;
      profiler.end(CPUStage.animation);
      profiler.start(CPUStage.encoding);
      now += 3;
      profiler.end(CPUStage.encoding);
      profiler.finishFrame();
      now += 1;
    }
    expect(profiler.frames).toBe(3);
    expect(profiler.history).toBe(history);
    expect(Array.from(profiler.totals)).toEqual([5, 5]);
    expect(profiler.history[CPUStage.animation]).toBe(2);
    expect(profiler.values[CPUStage.encoding]).toBe(3);
  });
  it("does not allocate query resources when timestamps are unsupported", async () => {
    const createQuerySet = vi.fn(),
      device = { features: new Set(), createQuerySet } as unknown as GPUDevice,
      profiler = new GPUProfiler(device, {} as Resources);
    profiler.enabled = true;
    profiler.beginFrame(0);
    expect(profiler.writes(0)).toBeUndefined();
    expect(createQuerySet).not.toHaveBeenCalled();
    profiler.enabled = false;
    expect(await profiler.readSamples()).toEqual([]);
  });
  it("bounds capture slots and reads timestamps only through explicit calls", async () => {
    vi.stubGlobal("GPUBufferUsage", {
      QUERY_RESOLVE: 1,
      COPY_SRC: 2,
      COPY_DST: 4,
      MAP_READ: 8,
    });
    vi.stubGlobal("GPUMapMode", { READ: 1 });
    const maps: ReturnType<typeof vi.fn>[] = [];
    const resources = {
      buffers: {
        create: ({ size }: { size: number }) => {
          const bytes = new ArrayBuffer(size),
            mapAsync = vi.fn(async () => {});
          new BigUint64Array(bytes).set([1000000n, 3500000n]);
          maps.push(mapAsync);
          return { mapAsync, getMappedRange: () => bytes, unmap: vi.fn() };
        },
      },
    } as unknown as Resources;
    const profiler = new GPUProfiler(
        {
          features: new Set(["timestamp-query"]),
          createQuerySet: () => ({ destroy: vi.fn() }),
        } as unknown as GPUDevice,
        resources,
      ),
      encoder = {
        resolveQuerySet: vi.fn(),
        copyBufferToBuffer: vi.fn(),
      } as unknown as GPUCommandEncoder;
    profiler.enabled = true;
    for (let frame = 0; frame < 4; frame++) {
      profiler.beginFrame(frame);
      profiler.writes(2);
      profiler.resolveFrame(encoder);
    }
    expect(profiler.droppedCaptures).toBe(1);
    expect(encoder.resolveQuerySet).toHaveBeenCalledTimes(3);
    maps.forEach((map) => expect(map).not.toHaveBeenCalled());
    await expect(profiler.readSamples()).rejects.toThrow(/Pause/);
    profiler.enabled = false;
    expect((await profiler.readSamples()).map((t) => t.milliseconds)).toEqual([
      2.5, 2.5, 2.5,
    ]);
    profiler.enabled = true;
    profiler.beginFrame(6);
    expect(profiler.writes(1)).toBeDefined();
    expect(profiler.droppedCaptures).toBe(1);
    vi.unstubAllGlobals();
  });
});
