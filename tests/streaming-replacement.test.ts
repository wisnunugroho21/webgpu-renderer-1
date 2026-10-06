import { expect, it, vi } from "vitest";
import { RendererStreaming } from "../src/rendering/RendererStreaming";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { LODGroups } from "../src/rendering/lod/LODGroups";
import type { MaterialTextures } from "../src/rendering/materials/MaterialTextures";
import type { MeshManager } from "../src/rendering/MeshManager";
import type { RuntimeAsset } from "../src/assets/gltf/RuntimeAsset";
/** Build a real lease/material owner with isolated mock texture preparation. */
function fixture() {
  const materials = new MaterialManager(4);
  materials.create({ baseColor: [0.2, 0.3, 0.4, 1] });
  const fallback = { label: "fallback" } as GPUBindGroup;
  const textures = {
    groups: [fallback],
    fallback,
    prepare: vi.fn(async (asset: RuntimeAsset) => {
      // Return distinct cold identities for each authored decoded source.
      return [{ label: asset.textures[0]!.name } as GPUBindGroup];
    }),
    release: vi.fn(async () => {
      // Shared streaming completion controls when this texture owner can be retired.
    }),
  } as unknown as MaterialTextures;
  const queue = {
    onSubmittedWorkDone: async () => {
      // Simulate cold submitted-work completion without a GPU device.
    },
  } as GPUQueue;
  const owner = new RendererStreaming(
    queue,
    {} as MeshManager,
    new LODGroups(),
    textures,
    materials,
    () => {
      // Return a stable diagnostic age stamp.
      return 0;
    },
    new RenderWorld(1),
    () => {
      // No byte budget is needed to test transactional lease publication.
      return { gpuBytes: 0, recoveryBytes: 0 };
    },
  );
  return { owner, materials, textures, fallback };
}
/** Supply one valid material and a named mock source for the cold texture uploader. */
function asset(name: string): RuntimeAsset {
  return {
    materials: [
      {
        textures: {},
        emissive: new Float32Array(3),
        normalScale: 1,
        occlusionStrength: 1,
      },
    ],
    textures: [{ name, mimeType: "image/png", image: new Uint8Array(1) }],
    meshes: [],
    nodes: [],
    skins: [],
    animations: [],
    cameras: [],
    scenes: [],
    defaultScene: 0,
  };
}
it("retains current residency through preparation and restores the original fallback on release", async () => {
  // An upgrade must not expose fallback textures or discard scalar authored factors while loading.
  const f = fixture();
  await f.owner.bindMaterial(0, "old", async () => {
    // Prepare the initial lower-quality resident through the existing public API.
    return asset("old");
  });
  const old = f.textures.groups[0];
  let finish!: (a: RuntimeAsset) => void;
  const next = f.owner.replaceMaterial(0, "new", () => {
    // Hold the new tier before decoding finishes.
    return new Promise((resolve) => {
      // Capture the explicit preparation completion for this scenario.
      finish = resolve;
    });
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.textures.groups[0]).toBe(old);
  expect(f.owner.resources.records.get("texture:old")?.references).toBe(1);
  finish(asset("new"));
  expect(await next).toBe(true);
  expect(f.textures.groups[0]?.label).toBe("new");
  expect(f.owner.resources.records.get("texture:old")?.references).toBe(0);
  expect(f.materials.data[0]).toBeCloseTo(0.2);
  f.owner.releaseMaterial(0);
  expect(f.textures.groups[0]).toBe(f.fallback);
  expect(f.owner.resources.records.get("texture:new")?.references).toBe(0);
});
it("leaves working textures pinned when replacement fails and cancels stale publication", async () => {
  // A failed decode or scene teardown must never publish a stale tier into another material state.
  const f = fixture();
  await f.owner.bindMaterial(0, "old", async () => {
    // Establish the stable resident that failures must preserve.
    return asset("old");
  });
  const old = f.textures.groups[0];
  await expect(
    f.owner.replaceMaterial(0, "failed", async () => {
      // Reject a cold load before any texture publication.
      throw new Error("decode failed");
    }),
  ).rejects.toThrow("decode failed");
  expect(f.textures.groups[0]).toBe(old);
  let finish!: (a: RuntimeAsset) => void;
  const pending = f.owner.replaceMaterial(0, "cancelled", () => {
    // Keep a publication in flight while the owning scene detaches its material slot.
    return new Promise((resolve) => {
      // Resolve the stale source after cancellation.
      finish = resolve;
    });
  });
  await Promise.resolve();
  await Promise.resolve();
  f.owner.releaseMaterial(0);
  finish(asset("cancelled"));
  expect(await pending).toBe(false);
  expect(f.textures.groups[0]).toBe(f.fallback);
  expect(f.owner.resources.records.get("texture:cancelled")?.references).toBe(
    0,
  );
});

it("rejects publication into a recycled material and preserves its new texture binding", async () => {
  // Source identity must outlive asynchronous decoding without relying on numeric slot equality.
  const f = fixture();
  let finish!: (a: RuntimeAsset) => void;
  const pending = f.owner.replaceMaterial(0, "retired", () => {
    // Hold the former lifetime's tier during scene removal and slot reuse.
    return new Promise((resolve) => {
      /* Complete the stale decode explicitly. */ finish = resolve;
    });
  });
  await Promise.resolve();
  await Promise.resolve();
  f.materials.release(0);
  expect(f.materials.create({ baseColor: [0, 0, 1, 1] })).toBe(0);
  const replacement = { label: "replacement" } as GPUBindGroup;
  f.textures.groups[0] = replacement;
  finish(asset("retired"));
  expect(await pending).toBe(false);
  expect(f.textures.groups[0]).toBe(replacement);
  expect(f.materials.generations[0]).toBe(2);
  expect(f.materials.data[2]).toBe(1);
});
