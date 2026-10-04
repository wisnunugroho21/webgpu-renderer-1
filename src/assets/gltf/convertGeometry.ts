import type { Mesh, Material, Skin, Node } from "@gltf-transform/core";
import type { RuntimeAsset } from "./RuntimeAsset";
import { readAccessor } from "./readAccessor";

/** Copy vertex and morph data, synthesize missing indices and reject invalid geometry. */
export function convertMeshes(
  meshes: Mesh[],
  materials: Material[],
): RuntimeAsset["meshes"] {
  return meshes.map(
    (mesh) => /** Keep mesh defaults separate from per-node morph weights. */ ({
      name: mesh.getName(),
      weights: new Float32Array(mesh.getWeights()),
      primitives: mesh.listPrimitives().map((primitive) => {
        // Each primitive gets independent vertex arrays and validated indices.

        const attributes: Record<string, Float32Array> = {};
        for (const semantic of primitive.listSemantics())
          attributes[semantic] = readAccessor(primitive.getAttribute(semantic));
        const position = primitive.getAttribute("POSITION");
        if (!position) throw new Error("Primitive has no POSITION accessor");
        const indexAccessor = primitive.getIndices(),
          indices = new Uint32Array(
            indexAccessor ? indexAccessor.getCount() : position.getCount(),
          );
        for (let i = 0; i < indices.length; i++)
          indices[i] = indexAccessor ? indexAccessor.getScalar(i) : i;
        for (const index of indices)
          if (index >= position.getCount())
            throw new Error("Primitive index out of range");
        return {
          attributes,
          indices,
          mode: primitive.getMode(),
          material: materials.indexOf(primitive.getMaterial()!),
          targets: primitive.listTargets().map((target) => {
            // Morph targets own their decoded deltas, independently of base geometry.

            const deltas: Record<string, Float32Array> = {};
            for (const semantic of target.listSemantics())
              deltas[semantic] = readAccessor(target.getAttribute(semantic));
            return deltas;
          }),
        };
      }),
    }),
  );
}

/** Copy joint references and inverse binds, supplying identity matrices when omitted. */
export function convertSkins(
  skins: Skin[],
  nodeIndex: Map<Node, number>,
): RuntimeAsset["skins"] {
  return skins.map((skin) => {
    // Keep joint order aligned with inverse-bind matrix order.

    const joints = new Uint32Array(
      skin
        .listJoints()
        .map((joint) =>
          /** Resolve joints against the document-wide node table. */ nodeIndex.get(
            joint,
          )!,
        ),
    );
    let inverseBindMatrices = readAccessor(skin.getInverseBindMatrices());
    if (!inverseBindMatrices.length) {
      inverseBindMatrices = new Float32Array(joints.length * 16);
      for (let i = 0; i < joints.length; i++)
        for (let j = 0; j < 4; j++) inverseBindMatrices[i * 16 + j * 5] = 1;
    }
    if (inverseBindMatrices.length !== joints.length * 16)
      throw new Error("Inverse-bind matrix count does not match joints");
    return {
      joints,
      inverseBindMatrices,
      skeleton: skin.getSkeleton() ? nodeIndex.get(skin.getSkeleton()!)! : -1,
    };
  });
}
