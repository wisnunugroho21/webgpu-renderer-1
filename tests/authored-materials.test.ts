import type { Material } from "../src/rendering/materials/Material";
import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import {
  KHRMaterialsClearcoat,
  KHRMaterialsIOR,
  KHRMaterialsSpecular,
  KHRMaterialsEmissiveStrength,
  KHRMaterialsUnlit,
  KHRTextureTransform,
} from "@gltf-transform/extensions";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import {
  isColorTexture,
  packTextureLayout,
} from "../src/rendering/materials/MaterialTextureLayout";
import { MATERIAL_WORDS } from "../src/rendering/layouts";
import { GLTFLoader } from "../src/assets/gltf/GLTFLoader";

describe("authored material publication", () => {
  // Assert transactional validation of authored factor and transform updates.

  it("validates before mutating factors, transforms or revisions", () => {
    // Failed publication must preserve the live GPU record and its cache revision.
    const manager = new MaterialManager(2),
      id = manager.create({
        clearcoat: 0.7,
        ior: 2.42,
        specularColor: [2, 0.5, 0.25],
        emissiveStrength: 8,
      });
    expect(manager.data.length).toBe(2 * MATERIAL_WORDS);
    expect(manager.data[20]).toBeCloseTo(2.42);
    expect(manager.data[27]).toBeCloseTo(0.7);
    const data = manager.data.slice(),
      revision = manager.revision;
    for (const material of [
      { ior: 0.5 },
      { specular: 2 },
      { clearcoat: NaN },
      { emissiveStrength: 1e100 },
      { specularColor: [1, 2] },
      { textures: { normal: { texCoord: 2 } } },
      { textures: { baseColor: { texCoord: 0, scale: [Infinity, 1] } } },
    ] as Material[])
      expect(() =>
        /** Attempt an invalid publication against the live material. */ manager.set(
          id,
          material,
        ),
      ).toThrow();
    expect(manager.data).toEqual(data);
    expect(manager.revision).toBe(revision);
    manager.set(id, { ior: 0, specular: 0, unlit: true });
    expect(manager.data[20]).toBe(0);
    expect(manager.data[23]).toBe(1);
  });
  it("packs rotated/scaled UV rows and restores complete streamed layouts", () => {
    // Affine order is offset + rotation * scale * UV, with independent per-role selectors.
    const manager = new MaterialManager(),
      id = manager.create({
        textures: {
          baseColor: {
            texCoord: 1,
            offset: [0.2, 0.3],
            scale: [2, 3],
            rotation: Math.PI / 2,
          },
          clearcoatNormal: { texCoord: 0 },
        },
      });
    const old = manager.textureLayout(id, true),
      rows = old.subarray(6, 14);
    expect(rows[0]).toBeCloseTo(0);
    expect(rows[1]).toBeCloseTo(-3);
    expect(rows[4]).toBeCloseTo(2);
    expect(rows[3]).toBe(1);
    expect(old[86]).toBe(4);
    manager.setTextureSlots(id, { specularColor: { texCoord: 0 } });
    expect(manager.textureLayout(id, true)[86]).toBe(16);
    manager.setTextureLayout(id, old);
    expect(manager.textureLayout(id, true)).toEqual(old);
    const invalid = old.slice();
    invalid[9] = 2;
    expect(() =>
      /** Attempt restoring an invalid affine UV selector without changing state. */ manager.setTextureLayout(
        id,
        invalid,
      ),
    ).toThrow();
    expect(manager.textureLayout(id, true)).toEqual(old);
    expect(isColorTexture("specularColor")).toBe(true);
    expect(isColorTexture("specular")).toBe(false);
    expect(isColorTexture("clearcoat")).toBe(false);
    expect(packTextureLayout()[6]).toBe(1);
  });
  it("imports all authored factors, maps and texture transform UV overrides from glTF", async () => {
    // Exercise actual extension registration and a serialized glTF round trip.
    const d = new Document(),
      texture = d
        .createTexture()
        .setMimeType("image/png")
        .setImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
      m = d.createMaterial();
    const coat = d
      .createExtension(KHRMaterialsClearcoat)
      .createClearcoat()
      .setClearcoatFactor(0.8)
      .setClearcoatRoughnessFactor(0.3)
      .setClearcoatTexture(texture)
      .setClearcoatRoughnessTexture(texture)
      .setClearcoatNormalTexture(texture)
      .setClearcoatNormalScale(0.7);
    const spec = d
      .createExtension(KHRMaterialsSpecular)
      .createSpecular()
      .setSpecularFactor(0.6)
      .setSpecularColorFactor([1, 0.5, 0.2])
      .setSpecularTexture(texture)
      .setSpecularColorTexture(texture);
    m.setExtension("KHR_materials_clearcoat", coat)
      .setExtension("KHR_materials_specular", spec)
      .setExtension(
        "KHR_materials_ior",
        d.createExtension(KHRMaterialsIOR).createIOR().setIOR(1.33),
      )
      .setExtension(
        "KHR_materials_emissive_strength",
        d
          .createExtension(KHRMaterialsEmissiveStrength)
          .createEmissiveStrength()
          .setEmissiveStrength(12),
      );
    coat
      .getClearcoatTextureInfo()!
      .setExtension(
        "KHR_texture_transform",
        d
          .createExtension(KHRTextureTransform)
          .createTransform()
          .setOffset([0.1, 0.2])
          .setScale([2, 3])
          .setRotation(0.5)
          .setTexCoord(1),
      );
    d.createMaterial().setExtension(
      "KHR_materials_unlit",
      d.createExtension(KHRMaterialsUnlit).createUnlit(),
    );
    const extensions = [
      KHRMaterialsClearcoat,
      KHRMaterialsSpecular,
      KHRMaterialsIOR,
      KHRMaterialsEmissiveStrength,
      KHRMaterialsUnlit,
      KHRTextureTransform,
    ];
    const json = await new NodeIO().registerExtensions(extensions).writeJSON(d),
      asset = await new GLTFLoader().parseJSON(json),
      out = asset.materials[0]!;
    expect(out.clearcoat).toBe(0.8);
    expect(out.clearcoatRoughness).toBe(0.3);
    expect(out.ior).toBe(1.33);
    expect(out.specular).toBe(0.6);
    expect(out.emissiveStrength).toBe(12);
    expect(Object.keys(out.textures)).toEqual([
      "clearcoat",
      "clearcoatRoughness",
      "clearcoatNormal",
      "specular",
      "specularColor",
    ]);
    expect(out.textures.clearcoat?.texCoord).toBe(1);
    expect(out.textures.clearcoat?.offset).toEqual([0.1, 0.2]);
    expect(out.textures.clearcoat?.rotation).toBe(0.5);
    expect(asset.materials[1]?.unlit).toBe(true);
  });
});
