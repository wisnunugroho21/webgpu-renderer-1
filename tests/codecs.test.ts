import { NodeIO } from "@gltf-transform/core";
import { expect, it } from "vitest";
import { GLTFLoader } from "../src/assets/gltf/GLTFLoader";
import { SkinVertexData } from "../src/animation/skinning/SkinVertexData";
const load = async (name: string) =>
  new GLTFLoader().parseJSON(
    await new NodeIO().readAsJSON(`public/regression/${name}.glb`),
  );
it("decodes actual lossless Draco and Meshopt geometry to the same triangle", async () => {
  const reference = (await load("triangle")).meshes[0]!.primitives[0]!;
  for (const name of ["triangle-draco", "triangle-meshopt"]) {
    const primitive = (await load(name)).meshes[0]!.primitives[0]!;
    // Draco may reorder vertices. Compare the indexed geometry rather than storage order.
    for (let i = 0; i < reference.indices.length; i++)
      for (let axis = 0; axis < 3; axis++)
        expect(
          primitive.attributes.POSITION![primitive.indices[i]! * 3 + axis],
        ).toBe(
          reference.attributes.POSITION![reference.indices[i]! * 3 + axis],
        );
  }
});
it("rejects ninth and higher influence semantics, including two-digit sets", async () => {
  const primitive = (await load("skinned")).meshes[0]!.primitives[0]!;
  for (const set of [2, 10, 100])
    expect(() =>
      SkinVertexData.fromPrimitive({
        ...primitive,
        attributes: {
          ...primitive.attributes,
          [`JOINTS_${set}`]: new Float32Array(4),
        },
      }),
    ).toThrow("More than eight");
});
it("retains secondary-only weights and jointly normalizes duplicated influences", async () => {
  const secondary = SkinVertexData.fromPrimitive(
    (await load("skinned-secondary")).meshes[0]!.primitives[0]!,
  )!;
  expect(secondary.primary.weights.every((v) => v === 0)).toBe(true);
  expect(secondary.secondary!.weights.some((v) => v > 0)).toBe(true);
  const duplicate = SkinVertexData.fromPrimitive(
    (await load("skinned-eight")).meshes[0]!.primitives[0]!,
  )!;
  for (let v = 0; v < duplicate.primary.weights.length; v += 4) {
    let sum = 0;
    for (let k = 0; k < 4; k++)
      sum +=
        duplicate.primary.weights[v + k]! +
        duplicate.secondary!.weights[v + k]!;
    expect(sum).toBeCloseTo(1);
  }
});
