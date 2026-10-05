import { bench } from "vitest";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import type { Material } from "../src/rendering/materials/Material";
const manager = new MaterialManager(1000);
for (let i = 0; i < 1000; i++) manager.create();
const authored: Material = {
  clearcoat: 0.8,
  clearcoatRoughness: 0.2,
  ior: 1.33,
  specular: 0.7,
  emissiveStrength: 3,
  textures: {
    clearcoat: { texCoord: 0 },
    specularColor: { texCoord: 1, rotation: 0.2, scale: [2, 2] },
  },
};
bench("publish 1000 authored material records", () => {
  // Cold authoring/publication includes validation and affine packing; frames only upload dirty rows.
  for (let i = 0; i < 1000; i++) manager.set(i, authored);
});
bench("snapshot and restore 1000 authored texture layouts", () => {
  // Exercise the complete streaming metadata contract outside ordinary frame encoding.
  for (let i = 0; i < 1000; i++)
    manager.setTextureLayout(i, manager.textureLayout(i, true));
});
