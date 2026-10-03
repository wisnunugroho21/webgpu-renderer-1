import { bench } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { GLTFLoader } from "../src/assets/gltf/GLTFLoader";
const document = new Document(),
  buffer = document.createBuffer();
const positions = new Float32Array(300000),
  normals = new Float32Array(300000);
for (let i = 0; i < 100000; i++) {
  positions[i * 3] = (i % 100) * 0.01;
  positions[i * 3 + 1] = Math.floor(i / 100) * 0.01;
  normals[i * 3 + 2] = 1;
}
const attribute = (data: Float32Array) =>
  document.createAccessor().setType("VEC3").setArray(data).setBuffer(buffer);
const primitive = document
  .createPrimitive()
  .setAttribute("POSITION", attribute(positions))
  .setAttribute("NORMAL", attribute(normals))
  .setIndices(
    document
      .createAccessor()
      .setType("SCALAR")
      .setArray(Uint32Array.from({ length: 99999 }, (_, i) => i))
      .setBuffer(buffer),
  );
document
  .createScene()
  .addChild(
    document
      .createNode()
      .setMesh(document.createMesh().addPrimitive(primitive)),
  );
const bytes = await new NodeIO().writeBinary(document),
  loader = new GLTFLoader();
bench("parse and convert 100000 glTF vertices", async () => {
  const asset = await loader.parseGLB(bytes);
  if (asset.meshes[0]!.primitives[0]!.attributes.POSITION!.length !== 300000)
    throw new Error("Decode mismatch");
});
import { MeshManager } from "../src/rendering/MeshManager";
import { Resources } from "../src/gpu/Resources";
Object.assign(globalThis, {
  GPUBufferUsage: { VERTEX: 1, INDEX: 2, COPY_DST: 4 },
});
const runtime = await loader.parseGLB(bytes);
const meshes = new MeshManager(
  { buffers: { create: () => ({}) } } as unknown as Resources,
  { writeBuffer: () => {} } as unknown as GPUQueue,
);
bench("preprocess and pack 100000 mesh vertices (no GPU upload)", () => {
  meshes.upload(runtime.meshes[0]!.primitives[0]!);
});
