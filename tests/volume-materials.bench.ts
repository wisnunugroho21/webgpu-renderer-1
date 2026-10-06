import { bench } from "vitest";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
const count = 1000,
  materials = new MaterialManager(count);
const definition = {
  transmission: 0.8,
  thickness: 0.6,
  attenuationDistance: 2,
  attenuationColor: [0.5, 0.25, 1],
  textures: {
    transmission: { texCoord: 0 },
    thickness: { texCoord: 1, offset: [0.2, 0.3], scale: [2, 2] },
  },
};
for (let i = 0; i < count; i++) materials.create(definition);
bench("1000 optical material validation and packing", () => {
  // Measure cold authored-factor and twelve-role affine publication, never frame-path material reconstruction.
  for (let i = 0; i < count; i++) materials.set(i, definition);
});
