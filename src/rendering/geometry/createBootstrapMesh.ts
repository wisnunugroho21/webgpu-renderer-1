import { MeshManager } from "../MeshManager";
/** Upload the startup cube once; every cube entity can share its numeric mesh ID. */
export function createBootstrapMesh(meshes: MeshManager): number {
  const vertices = new Float32Array([
    -1, -1, 1, 0.2, 0.65, 1, 1, -1, 1, 0.2, 0.65, 1, 1, 1, 1, 0.2, 0.65, 1, -1,
    1, 1, 0.2, 0.65, 1, 1, -1, -1, 0.9, 0.4, 0.2, -1, -1, -1, 0.9, 0.4, 0.2, -1,
    1, -1, 0.9, 0.4, 0.2, 1, 1, -1, 0.9, 0.4, 0.2, 1, -1, 1, 0.2, 0.9, 0.5, 1,
    -1, -1, 0.2, 0.9, 0.5, 1, 1, -1, 0.2, 0.9, 0.5, 1, 1, 1, 0.2, 0.9, 0.5, -1,
    -1, -1, 0.8, 0.3, 0.8, -1, -1, 1, 0.8, 0.3, 0.8, -1, 1, 1, 0.8, 0.3, 0.8,
    -1, 1, -1, 0.8, 0.3, 0.8, -1, 1, 1, 1, 0.8, 0.2, 1, 1, 1, 1, 0.8, 0.2, 1, 1,
    -1, 1, 0.8, 0.2, -1, 1, -1, 1, 0.8, 0.2, -1, -1, -1, 0.4, 0.3, 0.8, 1, -1,
    -1, 0.4, 0.3, 0.8, 1, -1, 1, 0.4, 0.3, 0.8, -1, -1, 1, 0.4, 0.3, 0.8,
  ]);
  const indices = new Uint16Array(36);
  for (let face = 0; face < 6; face++)
    indices.set(
      [0, 1, 2, 0, 2, 3].map(
        (i) => /** Computes the face * 4 + i result. */ face * 4 + i,
      ),
      face * 6,
    );
  const positions = new Float32Array(24 * 3),
    colors = new Float32Array(24 * 3);
  for (let i = 0; i < 24; i++)
    for (let j = 0; j < 3; j++) {
      positions[i * 3 + j] = vertices[i * 6 + j]!;
      colors[i * 3 + j] = vertices[i * 6 + 3 + j]!;
    }
  return meshes.upload({
    attributes: { POSITION: positions, COLOR_0: colors },
    indices: new Uint32Array(indices),
    mode: 4,
    material: 0,
    targets: [],
  });
}
