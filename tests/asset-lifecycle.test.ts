import { expect, it, vi } from "vitest";
import { uploadAsset, releaseUploadedAsset } from "../src/assets/uploadAsset";
import {
  RuntimeAsset,
  RuntimePrimitive,
} from "../src/assets/gltf/RuntimeAsset";
import { Resources } from "../src/gpu/Resources";
import { MeshManager } from "../src/rendering/MeshManager";
import { MorphDeltaBuffers } from "../src/rendering/MorphDeltaBuffers";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { MaterialTextures } from "../src/rendering/materials/MaterialTextures";
Object.assign(globalThis, {
  GPUBufferUsage: {
    VERTEX: 1,
    INDEX: 2,
    COPY_DST: 4,
    STORAGE: 8,
    COPY_SRC: 16,
  },
});
/** Builds controlled test dependencies and reusable state for asset-lifecycle. */
function fixture() {
  const primitive: RuntimePrimitive = {
    attributes: { POSITION: new Float32Array(9), NORMAL: new Float32Array(9) },
    indices: new Uint32Array([0, 1, 2]),
    mode: 4,
    material: -1,
    targets: [{ POSITION: new Float32Array(9) }],
  };
  const asset: RuntimeAsset = {
    meshes: [
      { name: "mesh", primitives: [primitive], weights: new Float32Array() },
    ],
    materials: [],
    textures: [],
    nodes: [],
    scenes: [],
    defaultScene: 0,
    cameras: [],
    animations: [],
    skins: [],
  };
  const queue = {
    writeBuffer: vi.fn(),
    onSubmittedWorkDone: vi.fn(async () => {
      // Intentionally performs no work at this optional callback boundary.
    }),
  } as unknown as GPUQueue;
  const device = {
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
    deltas = new MorphDeltaBuffers(resources, queue, 3),
    meshes = new MeshManager(resources, queue, deltas),
    materials = new MaterialManager(2);
  const groups: GPUBindGroup[] = [],
    textures = {
      groups: [],
      prepare: vi.fn(async () => /** Returns groups. */ groups),
      release: vi.fn(async () => {
        // Intentionally performs no work at this optional callback boundary.
      }),
    } as unknown as MaterialTextures;
  return {
    asset,
    primitive,
    queue,
    device,
    resources,
    deltas,
    meshes,
    materials,
    textures,
    groups,
  };
}
it("rolls back earlier primitives, material slots and texture ownership, then permits retry", async () => {
  // Verifies rolls back earlier primitives, material slots and texture ownership, then permits retry.

  const f = fixture();
  f.asset.meshes[0]!.primitives.push({ ...f.primitive, attributes: {} });
  const baseline = f.resources.stats.buffers;
  await expect(
    uploadAsset(f.asset, f.meshes, f.materials, f.textures, () => {
      // Intentionally performs no work at this optional callback boundary.
    }),
  ).rejects.toThrow("positions");
  expect(f.resources.stats.buffers).toBe(baseline);
  expect(f.deltas.count).toBe(0);
  expect(f.materials.available).toBe(2);
  expect(f.textures.release).toHaveBeenCalledWith(f.groups);
  expect(f.textures.groups.filter(Boolean)).toHaveLength(0);
  f.asset.meshes[0]!.primitives.pop();
  const uploaded = await uploadAsset(
    f.asset,
    f.meshes,
    f.materials,
    f.textures,
    () => {
      // Intentionally performs no work at this optional callback boundary.
    },
  );
  expect(f.deltas.count).toBe(3);
  await releaseUploadedAsset(uploaded, f.meshes, f.materials, f.textures, () =>
    /** Delegates this operation to f.meshes.fence. */ f.meshes.fence(),
  );
  expect(f.resources.stats.buffers).toBe(baseline);
  expect(f.deltas.count).toBe(0);
});
it("cleans partial buffer creation and write failures without leaking morph ranges", () => {
  // Verifies cleans partial buffer creation and write failures without leaking morph ranges.

  for (const stage of ["index", "write"] as const) {
    const f = fixture(),
      baseline = f.resources.stats.buffers;
    if (stage === "index")
      vi.mocked(f.device.createBuffer)
        .mockImplementationOnce(
          (d) =>
            /** Returns ({ size: d.size, destroy() {} }) as GPUBuffer. */ ({
              size: d.size,
              /** Intentionally performs no work at this optional callback boundary. */
              destroy() {},
            }) as GPUBuffer,
        )
        .mockImplementationOnce(() => {
          // Rejects invalid input for the current operation.

          throw new Error("allocation failed");
        });
    else
      vi.mocked(f.queue.writeBuffer)
        .mockImplementationOnce(() => {
          // Intentionally performs no work at this optional callback boundary.
        })
        .mockImplementationOnce(() => {
          // Intentionally performs no work at this optional callback boundary.
        })
        .mockImplementationOnce(() => {
          // Intentionally performs no work at this optional callback boundary.
        })
        .mockImplementationOnce(() => {
          // Rejects invalid input for the current operation.

          throw new Error("write failed");
        });
    expect(() =>
      /** Delegates this operation to f.meshes.upload. */ f.meshes.upload(
        f.primitive,
      ),
    ).toThrow("failed");
    expect(f.resources.stats.buffers).toBe(baseline);
    expect(f.deltas.count).toBe(0);
  }
});
it("rolls back when cancellation/device loss occurs after texture preparation", async () => {
  // Verifies rolls back when cancellation/device loss occurs after texture preparation.

  const f = fixture();
  let checks = 0;
  await expect(
    uploadAsset(f.asset, f.meshes, f.materials, f.textures, () => {
      // Rejects invalid input for the current operation.

      if (++checks === 2) throw new Error("cancelled");
    }),
  ).rejects.toThrow("cancelled");
  expect(f.textures.release).toHaveBeenCalledWith(f.groups);
  expect(f.materials.available).toBe(2);
});
it("does not reuse live material IDs and resets released metadata", () => {
  // Verifies does not reuse live material IDs and resets released metadata.

  const m = new MaterialManager(2),
    a = m.create({ alphaMode: "BLEND", doubleSided: true }),
    b = m.create();
  m.release(a);
  expect(() => /** Delegates this operation to m.set. */ m.set(a, {})).toThrow(
    "Unknown",
  );
  expect(m.create()).toBe(a);
  expect(m.pipelineIndex(a)).toBe(0);
  expect(m.alive[b]).toBe(1);
});
it("reuses freed morph ranges without changing offsets owned by another asset", () => {
  // Verifies reuses freed morph ranges without changing offsets owned by another asset.

  const f = fixture();
  const small: RuntimePrimitive = {
    ...f.primitive,
    targets: [],
    attributes: { POSITION: new Float32Array(3), NORMAL: new Float32Array(3) },
    mode: 0,
    indices: new Uint32Array([0]),
  };
  small.targets = [{ POSITION: new Float32Array(3) }];
  const a = f.meshes.upload(small),
    b = f.meshes.upload(small);
  f.meshes.destroy(a);
  const c = f.meshes.upload(small);
  expect(f.meshes.get(c).morphOffset).toBe(0);
  expect(f.meshes.get(b).morphOffset).toBe(1);
});
