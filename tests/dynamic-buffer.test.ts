import { describe, expect, it, vi } from "vitest";
import { DynamicBufferAllocator } from "../src/gpu/DynamicBufferAllocator";
import { BufferManager } from "../src/gpu/BufferManager";
import { ResourceStats } from "../src/gpu/ResourceStats";
Object.assign(globalThis, {
  GPUBufferUsage: { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 },
});
function allocator(capacity = 1024 * 1024) {
  const stats = new ResourceStats(),
    device = {
      createBuffer: vi.fn((d: GPUBufferDescriptor) => ({
        size: d.size,
        destroy: vi.fn(),
      })),
    } as unknown as GPUDevice;
  return {
    arena: new DynamicBufferAllocator(
      new BufferManager(device, stats),
      capacity,
      256,
      64,
    ),
    stats,
  };
}
describe("shared dynamic arena", () => {
  it("uses exactly three buffers for 10,000 object records across frames", () => {
    const { arena, stats } = allocator();
    for (let frame = 0; frame < 6; frame++) {
      arena.beginFrame(frame);
      for (let i = 0; i < 10000; i++)
        expect(arena.allocate(64, 16)).toBe(i * 64);
      expect(arena.buffer).toBe(arena.buffers[frame % 3]);
    }
    expect(stats.bufferCreations).toBe(3);
    expect(stats.buffers).toBe(3);
  });
  it("aligns records, preserves data and uploads one contiguous range", () => {
    const { arena } = allocator();
    arena.beginFrame(1);
    const first = arena.allocate(64),
      second = arena.allocate(16);
    expect(first).toBe(0);
    expect(second).toBe(256);
    arena.write(second, new Float32Array([1, 2, 3, 4]));
    expect(new Float32Array(arena.staging.buffer, second, 4)[2]).toBe(3);
    const queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    arena.flush(queue);
    expect(queue.writeBuffer).toHaveBeenCalledWith(
      arena.buffers[1],
      0,
      arena.staging.buffer,
      0,
      272,
    );
    expect(arena.uploadBytes).toBe(272);
  });
  it("fails capacity/range checks without growing buffers", () => {
    const { arena, stats } = allocator(256);
    arena.allocate(256);
    expect(() => arena.allocate(4)).toThrow("capacity exceeded");
    expect(() => arena.write(256, new Float32Array([1]))).toThrow();
    expect(() => arena.allocate(3)).toThrow();
    expect(() => arena.beginFrame(-1)).toThrow();
    expect(stats.bufferCreations).toBe(3);
  });
});
