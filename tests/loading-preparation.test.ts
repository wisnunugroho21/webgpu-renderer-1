import { expect, it, vi } from "vitest";
import {
  prepareMesh,
  restorePreparedMesh,
} from "../src/rendering/geometry/prepareMesh";
import { MeshManager } from "../src/rendering/MeshManager";
import { Resources } from "../src/gpu/Resources";
import {
  encodeEnvironmentArchive,
  decodeEnvironmentArchive,
} from "../src/rendering/environment/EnvironmentArchive";
import { bakeEnvironment } from "../src/rendering/environment/bakeEnvironment";
import { EnvironmentLoader } from "../src/rendering/environment/EnvironmentLoader";
const primitive = (vertices = 3) => ({
  attributes: {
    POSITION: new Float32Array(vertices * 3),
    NORMAL: new Float32Array(vertices * 3),
  },
  indices: new Uint32Array([0, 1, 2]),
  mode: 4,
  material: -1,
  targets: [],
});
it("restores worker-prepared metadata with canonical skin validation and bit-exact vertices", () => {
  const source = {
    ...primitive(),
    attributes: {
      ...primitive().attributes,
      JOINTS_0: new Float32Array(12),
      WEIGHTS_0: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    },
  };
  const reference = prepareMesh(source),
    clone = structuredClone(reference);
  restorePreparedMesh(clone);
  expect(clone.vertices).toEqual(reference.vertices);
  expect(clone.skin).toBeDefined();
  clone.skin!.validateJointCount(1);
  expect(() => clone.skin!.validateJointCount(0)).toThrow();
});
it("bounds upload writes and rolls back cancellation between chunks", async () => {
  Object.assign(globalThis, {
    GPUBufferUsage: { VERTEX: 1, INDEX: 2, COPY_DST: 4 },
  });
  const created: { size: number; destroy: () => void }[] = [];
  const resources = new Resources({
    createBuffer: (descriptor: GPUBufferDescriptor) => {
      const buffer = { size: descriptor.size, destroy: vi.fn() };
      created.push(buffer);
      return buffer;
    },
  } as unknown as GPUDevice);
  const sizes: number[] = [];
  const queue = {
    writeBuffer: (_buffer: GPUBuffer, _offset: number, data: Float32Array) =>
      sizes.push(data.byteLength),
  } as unknown as GPUQueue;
  const manager = new MeshManager(resources, queue),
    source = primitive(20000);
  let checks = 0;
  await expect(
    manager.uploadAsync(source, () => {
      if (++checks === 3) throw new Error("cancelled");
    }),
  ).rejects.toThrow("cancelled");
  expect(manager.entries).toHaveLength(0);
  expect(resources.stats.buffers).toBe(0);
  expect(sizes.every((size) => size <= 1024 * 1024)).toBe(true);
  const id = await manager.uploadAsync(source, () => {});
  expect(manager.get(id).indexCount).toBe(3);
  manager.destroy(id);
  expect(resources.stats.buffers).toBe(0);
});
it("round-trips precomputed bakes exactly and rejects corrupt/versioned payloads", async () => {
  const data = bakeEnvironment((_direction, out) => out.fill(0.5), {
    specularSize: 2,
    diffuseSize: 1,
    brdfSize: 2,
    samples: 8,
  });
  const bytes = encodeEnvironmentArchive(data);
  expect(decodeEnvironmentArchive(bytes)).toEqual(data);
  const loader = new EnvironmentLoader();
  expect(await loader.decode(bytes)).toEqual(data);
  expect(loader.metrics.archives).toBe(1);
  expect(loader.metrics.bakes).toBe(0);
  const bad = bytes.slice();
  new DataView(bad.buffer).setUint32(4, 99, true);
  expect(() => decodeEnvironmentArchive(bad)).toThrow("version");
  expect(() =>
    decodeEnvironmentArchive(bytes.subarray(0, bytes.length - 1)),
  ).toThrow("length");
  new DataView(bad.buffer).setUint32(4, 1, true);
  new DataView(bad.buffer).setFloat32(24, NaN, true);
  expect(() => decodeEnvironmentArchive(bad)).toThrow("finite");
  loader.clear();
});
