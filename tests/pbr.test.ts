import { mipLevelCount } from "../src/rendering/materials/MipGenerator";
import { describe, expect, it, vi } from "vitest";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { samplerDescriptor } from "../src/rendering/materials/MaterialTextures";
import { MeshManager } from "../src/rendering/MeshManager";
import { Resources } from "../src/gpu/Resources";
Object.assign(globalThis, {
  GPUBufferUsage: { VERTEX: 32, INDEX: 16, COPY_DST: 8 },
});
describe("PBR asset inputs", () => {
  // Groups checks for PBR asset inputs.

  it("uses a full mip chain and clamps anisotropy to filter compatibility", () => {
    // Verifies uses a full mip chain and clamps anisotropy to filter compatibility.

    expect(mipLevelCount(1, 1)).toBe(1);
    expect(mipLevelCount(3, 5)).toBe(3);
    expect(mipLevelCount(512, 1)).toBe(10);
    expect(() =>
      /** Delegates this operation to mipLevelCount. */ mipLevelCount(0, 4),
    ).toThrow();
    expect(samplerDescriptor(undefined, 32).maxAnisotropy).toBe(16);
    expect(
      samplerDescriptor(
        {
          texture: 0,
          texCoord: 0,
          wrapS: 10497,
          wrapT: 10497,
          magFilter: 9728,
          minFilter: 9987,
        },
        8,
      ).maxAnisotropy,
    ).toBe(1);
  });
  it("packs factors, UV choices and flags in one shared record", () => {
    // Verifies packs factors, UV choices and flags in one shared record.

    const m = new MaterialManager(1);
    m.create({
      emissive: [0.1, 0.2, 0.3],
      normalScale: 0.7,
      occlusionStrength: 0.4,
      doubleSided: true,
      textures: { normal: { texCoord: 1 }, emissive: { texCoord: 1 } },
    });
    expect(Array.from(m.data.slice(8, 12))).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
      expect.closeTo(0.3),
      expect.closeTo(0.7),
    ]);
    expect(Array.from(m.data.slice(12, 16))).toEqual([
      expect.closeTo(0.4),
      1,
      1,
      1,
    ]);
    expect(Array.from(m.data.slice(16, 20))).toEqual([0, 0, 1, 0]);
    const before = m.data.slice();
    expect(() =>
      /** Delegates this operation to m.set. */ m.set(0, {
        baseColor: [0.2, 0.3, 0.4, 1],
        emissive: [NaN, 0, 0],
      }),
    ).toThrow();
    expect(m.data).toEqual(before);
    expect(() =>
      /** Delegates this operation to m.set. */ m.set(0, {
        textures: { normal: { texCoord: 2 } },
      }),
    ).toThrow();
    expect(m.data).toEqual(before);
  });
  it("maps glTF sampler modes including no-mipmap filters", () => {
    // Verifies maps glTF sampler modes including no-mipmap filters.

    expect(
      samplerDescriptor({
        texture: 0,
        texCoord: 0,
        wrapS: 33071,
        wrapT: 33648,
        magFilter: 9728,
        minFilter: 9728,
      }),
    ).toMatchObject({
      addressModeU: "clamp-to-edge",
      addressModeV: "mirror-repeat",
      magFilter: "nearest",
      minFilter: "nearest",
      lodMaxClamp: 0,
    });
    expect(samplerDescriptor()).toMatchObject({
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
    });
  });
  it("uploads vertex alpha, both UV sets, tangents and generated normals", () => {
    // Verifies uploads vertex alpha, both UV sets, tangents and generated normals.

    const queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
    const device = {
      createBuffer: vi.fn(
        (d) => /** Builds a record containing size, destroy. */ ({
          size: d.size,
          destroy: vi.fn(),
        }),
      ),
    } as unknown as GPUDevice;
    const mesh = new MeshManager(new Resources(device), queue);
    mesh.upload({
      mode: 4,
      indices: new Uint32Array([0, 1, 2]),
      material: 0,
      targets: [],
      attributes: {
        POSITION: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        COLOR_0: new Float32Array([1, 0, 0, 0.4, 0, 1, 0, 0.5, 0, 0, 1, 0.6]),
        TEXCOORD_0: new Float32Array([0.1, 0.2, 0, 0, 0, 0]),
        TEXCOORD_1: new Float32Array([0.3, 0.4, 0, 0, 0, 0]),
        TANGENT: new Float32Array([1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1]),
      },
    });
    const vertex = vi.mocked(queue.writeBuffer).mock
      .calls[0]![2] as Float32Array;
    expect(vertex.length).toBe(78);
    expect(vertex[6]).toBeCloseTo(0.4);
    expect(Array.from(vertex.slice(7, 10))).toEqual([0, 0, 1]);
    expect(vertex[10]).toBeCloseTo(0.1);
    expect(vertex[16]).toBeCloseTo(0.3);
    expect(Array.from(vertex.slice(12, 16))).toEqual([1, 0, 0, -1]);
  });
});
