import { Document, NodeIO } from "@gltf-transform/core";
import { mkdir } from "node:fs/promises";
const d = new Document(),
  buffer = d.createBuffer(),
  positions = new Float32Array(300000),
  normals = new Float32Array(300000);
for (let i = 0; i < 100000; i++) {
  positions[i * 3] = (i % 100) * 0.01;
  positions[i * 3 + 1] = Math.floor(i / 100) * 0.01;
  normals[i * 3 + 2] = 1;
}
/** Creates a glTF accessor with the requested component data and buffer ownership. */
const attr = (data) =>
  d.createAccessor().setType("VEC3").setArray(data).setBuffer(buffer);
const p = d
  .createPrimitive()
  .setAttribute("POSITION", attr(positions))
  .setAttribute("NORMAL", attr(normals))
  .setIndices(
    d
      .createAccessor()
      .setType("SCALAR")
      .setArray(
        Uint32Array.from({ length: 99999 }, (_, i) => /** Returns i. */ i),
      )
      .setBuffer(buffer),
  );
d.createScene().addChild(
  d.createNode().setMesh(d.createMesh().addPrimitive(p)),
);
await mkdir("artifacts", { recursive: true });
await new NodeIO().write("artifacts/worker-large.glb", d);
