import { describe, it, expect } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import {
  KHRMaterialsTransmission,
  KHRMaterialsVolume,
  KHRTextureTransform,
} from "@gltf-transform/extensions";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { GLTFLoader } from "../src/assets/gltf/GLTFLoader";
import type { Material } from "../src/rendering/materials/Material";
describe("authored optical materials", () => {
  // Authored optical factors must remain atomic and independent of alpha coverage and renderer enablement.
  it("packs volume factors while retaining authored coverage and transparent scheduling", () => {
    // Opaque optical transmission is a fully covered transparent draw, rather than alpha fading.
    const m = new MaterialManager(1),
      id = m.create({
        transmission: 1,
        thickness: 2,
        attenuationDistance: 3,
        attenuationColor: [0.5, 0.25, 1],
      });
    expect(m.alphaMode[id]).toBe(2);
    expect(m.data[6]).toBe(0);
    expect(Array.from(m.data.slice(32, 40))).toEqual([
      1, 2, 0, 0, 0.5, 0.25, 1, 3,
    ]);
    m.set(id, { transmission: 1, alphaMode: "MASK", alphaCutoff: 0.2 });
    expect(m.alphaMode[id]).toBe(2);
    expect(m.data[6]).toBe(1);
    expect(m.data[39]).toBe(0);
    m.set(id, {});
    expect(m.alphaMode[id]).toBe(0);
  });
  it("rejects invalid factors atomically and preserves legacy texture-layout patches", () => {
    // Invalid optical definitions cannot mutate scalar rows, alpha scheduling or GPU dirty stamps.
    const m = new MaterialManager(1),
      id = m.create({
        transmission: 0.5,
        textures: { thickness: { texCoord: 1 } },
      }),
      before = m.data.slice();
    const invalid: Material[] = [
      { transmission: 2 },
      { thickness: -1 },
      { attenuationColor: [2, 1, 1] },
      { attenuationDistance: 0 },
      { attenuationDistance: NaN },
      { transmission: 1, unlit: true },
    ];
    for (const value of invalid) {
      expect(() => {
        // Exercise each preflight before allowing a new authored material record.
        return m.set(id, value);
      }).toThrow("Invalid transmission/volume");
      expect(m.data).toEqual(before);
    }
    const extended = m.textureLayout(id, true),
      legacy = extended.slice(0, 87);
    legacy[86] = 0;
    m.setTextureLayout(id, legacy);
    expect(m.textureLayout(id, true)[102]).toBe(64);
    expect(m.data[32]).toBe(0.5);
  });
  it("imports transmission/volume maps, factors and UV transforms from serialized glTF", async () => {
    // A real glTF extension round trip verifies lazy registration and author-space thickness semantics.
    const d = new Document(),
      texture = d
        .createTexture()
        .setMimeType("image/png")
        .setImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    const t = d
      .createExtension(KHRMaterialsTransmission)
      .createTransmission()
      .setTransmissionFactor(0.8)
      .setTransmissionTexture(texture);
    const v = d
      .createExtension(KHRMaterialsVolume)
      .createVolume()
      .setThicknessFactor(0.6)
      .setThicknessTexture(texture)
      .setAttenuationDistance(2)
      .setAttenuationColor([0.5, 0.25, 1]);
    t.getTransmissionTextureInfo()!
      .setTexCoord(1)
      .setExtension(
        "KHR_texture_transform",
        d
          .createExtension(KHRTextureTransform)
          .createTransform()
          .setOffset([0.2, 0.3]),
      );
    d.createMaterial()
      .setExtension("KHR_materials_transmission", t)
      .setExtension("KHR_materials_volume", v);
    const json = await new NodeIO()
        .registerExtensions([
          KHRMaterialsTransmission,
          KHRMaterialsVolume,
          KHRTextureTransform,
        ])
        .writeJSON(d),
      asset = await new GLTFLoader().parseJSON(json),
      out = asset.materials[0]!;
    expect(out.transmission).toBe(0.8);
    expect(out.thickness).toBe(0.6);
    expect(out.attenuationDistance).toBe(2);
    expect(out.attenuationColor).toEqual([0.5, 0.25, 1]);
    expect(out.textures.transmission?.texCoord).toBe(1);
    expect(out.textures.transmission?.offset).toEqual([0.2, 0.3]);
    expect(out.textures.thickness?.texture).toBe(0);
  });
});
