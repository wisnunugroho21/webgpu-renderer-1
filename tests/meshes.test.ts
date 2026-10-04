import { describe, it, expect, vi } from "vitest";
import { MeshManager } from "../src/rendering/MeshManager";
import { Resources } from "../src/gpu/Resources";
import { RuntimePrimitive } from "../src/assets/gltf/RuntimeAsset";
Object.assign(globalThis, {
  GPUBufferUsage: { VERTEX: 32, INDEX: 16, COPY_DST: 8 },
});
describe("mesh asset uploads", () => {
  // Groups checks for mesh asset uploads.

  for (const [mode, expected, topology] of [
    [0, [0, 1, 2, 3], 2],
    [1, [0, 1, 2, 3], 1],
    [2, [0, 1, 1, 2, 2, 3, 3, 0], 1],
    [3, [0, 1, 1, 2, 2, 3], 1],
    [4, [0, 1, 2], 0],
    [5, [0, 1, 2, 2, 1, 3], 0],
    [6, [0, 1, 2, 0, 2, 3], 0],
  ] as const) {
    it(`converts primitive mode ${mode} once into a shared GPU mesh`, () => {
      // Verifies mesh asset uploads.

      const queue = { writeBuffer: vi.fn() } as unknown as GPUQueue,
        device = {
          createBuffer: vi.fn(
            (
              d: GPUBufferDescriptor,
            ) => /** Builds a record containing size, destroy. */ ({
              size: d.size,
              destroy: vi.fn(),
            }),
          ),
        } as unknown as GPUDevice;
      const resources = new Resources(device),
        meshes = new MeshManager(resources, queue);
      const primitive: RuntimePrimitive = {
        attributes: {
          POSITION: new Float32Array(12),
          NORMAL: new Float32Array(12),
        },
        indices: new Uint32Array(mode === 4 ? [0, 1, 2] : [0, 1, 2, 3]),
        mode,
        material: -1,
        targets: [],
      };
      const id = meshes.upload(primitive);
      expect(meshes.get(id).topology).toBe(topology);
      expect(meshes.get(id).indexCount).toBe(expected.length);
      expect(queue.writeBuffer).toHaveBeenLastCalledWith(
        meshes.get(id).index,
        0,
        new Uint32Array(expected),
      );
      expect(resources.stats.bufferCreations).toBe(2);
      expect(() =>
        /** Returns the keyed entry from meshes. */ meshes.get(5),
      ).toThrow("Unknown mesh");
    });
  }
});
