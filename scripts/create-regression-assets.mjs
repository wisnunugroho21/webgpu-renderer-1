import { Document, NodeIO } from "@gltf-transform/core";
import { mkdir } from "node:fs/promises";
const document = new Document(),
  buffer = document.createBuffer();
const positions = document
  .createAccessor()
  .setType("VEC3")
  .setArray(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]))
  .setBuffer(buffer);
const material = document.createMaterial().setBaseColorFactor([0.7, 0.2, 1, 1]);
const mesh = document
  .createMesh("Regression triangle")
  .addPrimitive(
    document
      .createPrimitive()
      .setAttribute("POSITION", positions)
      .setMaterial(material),
  );
const scene = document
  .createScene()
  .addChild(document.createNode().setMesh(mesh));
document.getRoot().setDefaultScene(scene);
await mkdir("public/regression", { recursive: true });
await new NodeIO().write("public/regression/triangle.glb", document);
