import { bench, describe } from "vitest";
import { MeshClusters } from "../src/rendering/geometry/MeshClusters";
const positions = new Float32Array(100001 * 3),
  indices = new Uint32Array(200000 * 3);
for (let i = 0; i < positions.length / 3; i++) {
  positions[i * 3] = i % 1000;
  positions[i * 3 + 1] = Math.floor(i / 1000);
}
for (let i = 0; i < indices.length; i++) indices[i] = i % 100001;
describe("Phase 44 optional geometry cold preparation", () => {
  bench("200,000 triangles into conservative 256-triangle clusters", () => {
    new MeshClusters(positions, indices);
  });
});
