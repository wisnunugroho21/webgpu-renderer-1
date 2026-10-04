import { bench } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { GLTFLoader } from "../src/assets/gltf/GLTFLoader";
const d = new Document(),
  buffer = d.createBuffer(),
  data = new Float32Array(30000);
for (let i = 0; i < data.length; i++) data[i] = i % 3;
const positions = d
    .createAccessor()
    .setType("VEC3")
    .setArray(data)
    .setBuffer(buffer),
  mesh = d.createMesh().addPrimitive(
    d
      .createPrimitive()
      .setAttribute("POSITION", positions)
      .setIndices(
        d
          .createAccessor()
          .setType("SCALAR")
          .setArray(
            Uint32Array.from({ length: 9999 }, (_, i) => /** Returns i. */ i),
          )
          .setBuffer(buffer),
      ),
  );
d.createScene().addChild(d.createNode().setMesh(mesh));
const bytes = await new NodeIO().writeBinary(d),
  loader = new GLTFLoader();
bench("Phase 13 decode GLB with 10,000 vertices", async () => {
  // Measures Phase 13 decode GLB with 10,000 vertices.

  const asset = await loader.parseGLB(bytes);
  if (asset.meshes[0]!.primitives[0]!.attributes.POSITION!.length !== 30000)
    throw new Error("Decode mismatch");
});
