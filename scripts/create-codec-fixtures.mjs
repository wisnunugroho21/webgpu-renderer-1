import { NodeIO } from "@gltf-transform/core";
import {
  KHRDracoMeshCompression,
  EXTMeshoptCompression,
  KHRTextureBasisu,
} from "@gltf-transform/extensions";
import draco from "draco3dgltf";
import { MeshoptEncoder } from "meshoptimizer";
import { readFile, writeFile } from "node:fs/promises";
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([
    KHRDracoMeshCompression,
    EXTMeshoptCompression,
    KHRTextureBasisu,
  ])
  .registerDependencies({
    "draco3d.encoder": await draco.createEncoderModule(),
    "meshopt.encoder": MeshoptEncoder,
  });
for (const [name, extension] of [
  ["draco", KHRDracoMeshCompression],
  ["meshopt", EXTMeshoptCompression],
]) {
  const document = await io.read("public/regression/triangle.glb");
  const primitive = document.getRoot().listMeshes()[0].listPrimitives()[0];
  if (!primitive.getIndices())
    primitive.setIndices(
      document
        .createAccessor()
        .setType("SCALAR")
        .setArray(
          Uint16Array.from(
            { length: primitive.getAttribute("POSITION").getCount() },
            (_, i) => i,
          ),
        )
        .setBuffer(document.getRoot().listBuffers()[0]),
    );
  const codec = document.createExtension(extension).setRequired(true);
  if (name === "draco")
    codec.setEncoderOptions({
      quantizationBits: { POSITION: 0, NORMAL: 0, TEX_COORD: 0, GENERIC: 0 },
    });
  await io.write(`public/regression/triangle-${name}.glb`, document);
}
const skinned = await io.read("public/regression/skinned.glb"),
  primitive = skinned.getRoot().listMeshes()[0].listPrimitives()[0];
primitive.setAttribute("JOINTS_1", primitive.getAttribute("JOINTS_0").clone());
primitive.setAttribute(
  "WEIGHTS_1",
  primitive.getAttribute("WEIGHTS_0").clone(),
);
await io.write("public/regression/skinned-eight.glb", skinned);
primitive
  .getAttribute("WEIGHTS_0")
  .setArray(
    new Float32Array(primitive.getAttribute("WEIGHTS_0").getArray().length),
  );
await io.write("public/regression/skinned-secondary.glb", skinned);
const combined = await io.read("public/regression/crowd-combined.glb"),
  combinedPrimitive = combined.getRoot().listMeshes()[0].listPrimitives()[0];
combinedPrimitive.setAttribute(
  "JOINTS_1",
  combinedPrimitive.getAttribute("JOINTS_0").clone(),
);
combinedPrimitive.setAttribute(
  "WEIGHTS_1",
  combinedPrimitive.getAttribute("WEIGHTS_0").clone(),
);
await io.write("public/regression/combined-eight.glb", combined);
for (const name of ["etc1s", "uastc"]) {
  const document = await io.read("public/regression/triangle.glb");
  document.createExtension(KHRTextureBasisu).setRequired(true);
  const texture = document
    .createTexture()
    .setMimeType("image/ktx2")
    .setImage(
      new Uint8Array(await readFile(`public/regression/basis-${name}.ktx2`)),
    );
  document.getRoot().listMaterials()[0].setBaseColorTexture(texture);
  await io.write(`public/regression/triangle-basis-${name}.glb`, document);
}
await writeFile(
  "public/regression/CODEC_FIXTURES.md",
  `Generated geometry fixtures: node scripts/create-codec-fixtures.mjs.\nBasis samples from Three.js r185, examples/textures/ktx2/2d_etc1s.ktx2 and 2d_uastc.ktx2 (MIT repository).\nSource: https://github.com/mrdoob/three.js/tree/r185/examples/textures/ktx2\n`,
);
