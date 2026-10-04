import { Document, NodeIO } from "@gltf-transform/core";
import { mkdir } from "node:fs/promises";
await mkdir("public/regression", { recursive: true });
// Long fixture is opt-in so the original A–G assets remain reproducible.
for (const kind of process.argv.includes("--long")
  ? ["skin-long"]
  : ["skin", "morph", "combined"]) {
  const d = new Document(),
    buffer = d.createBuffer();
  /** Creates a glTF accessor with the requested component data and buffer ownership. */
  const attr = (type, data) =>
    d.createAccessor().setType(type).setArray(data).setBuffer(buffer);
  const positions = new Float32Array(400 * 3),
    normals = new Float32Array(400 * 3),
    tangents = new Float32Array(400 * 4),
    indices = [];
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const i = y * 20 + x;
      positions[i * 3] = x / 19 - 0.5;
      positions[i * 3 + 1] = y / 19 - 0.5;
      normals[i * 3 + 2] = 1;
      tangents[i * 4] = tangents[i * 4 + 3] = 1;
      if (x < 19 && y < 19)
        indices.push(i, i + 1, i + 20, i + 1, i + 21, i + 20);
    }
  const primitive = d
    .createPrimitive()
    .setAttribute("POSITION", attr("VEC3", positions))
    .setAttribute("NORMAL", attr("VEC3", normals))
    .setAttribute("TANGENT", attr("VEC4", tangents))
    .setIndices(attr("SCALAR", new Uint32Array(indices)));
  const material = d
    .createMaterial()
    .setMetallicFactor(0)
    .setRoughnessFactor(1);
  primitive.setMaterial(material);
  const mesh = d.createMesh().addPrimitive(primitive),
    node = d.createNode("Mesh").setMesh(mesh),
    root = d.createNode("Character").addChild(node);
  if (!kind.startsWith("skin")) {
    for (let t = 0; t < 16; t++) {
      const delta = new Float32Array(positions.length),
        normal = new Float32Array(positions.length),
        tangent = new Float32Array(positions.length);
      for (let i = 0; i < 400; i++) {
        delta[i * 3 + 2] = 0.002 * (t + 1);
        normal[i * 3] = 0.001 * (t + 1);
        tangent[i * 3 + 1] = 0.001 * (t + 1);
      }
      primitive.addTarget(
        d
          .createPrimitiveTarget()
          .setAttribute("POSITION", attr("VEC3", delta))
          .setAttribute("NORMAL", attr("VEC3", normal))
          .setAttribute("TANGENT", attr("VEC3", tangent)),
      );
    }
    mesh.setWeights(Array(16).fill(0));
  }
  if (kind !== "morph") {
    const joints = [],
      bind = new Float32Array(64 * 16),
      times = attr(
        "SCALAR",
        kind === "skin-long"
          ? Float32Array.from(
              { length: 1024 },
              (_, k) =>
                /** Computes the (k * 30) / 1023 result. */ (k * 30) / 1023,
            )
          : new Float32Array([0, 1]),
      ),
      rotations = attr(
        "VEC4",
        new Float32Array([0, 0, 0, 1, 0, 0, 0.02, Math.sqrt(1 - 0.0004)]),
      ),
      animation = d.createAnimation("64 joint rotations");
    for (let j = 0; j < 64; j++) {
      const joint = d
        .createNode(`Joint ${j}`)
        .setTranslation([0, j ? 0.01 : 0, 0]);
      if (j) joints[j - 1].addChild(joint);
      else root.addChild(joint);
      joints.push(joint);
      bind[j * 16] =
        bind[j * 16 + 5] =
        bind[j * 16 + 10] =
        bind[j * 16 + 15] =
          1;
      bind[j * 16 + 13] = -j * 0.01;
      // Distinct smooth joint curves; immutable key data is shared by instances.
      const longKeys = new Float32Array(1024 * 4);
      if (kind === "skin-long")
        for (let k = 0; k < 1024; k++) {
          const angle = 0.025 * Math.sin((k * Math.PI * 8) / 1023 + j * 0.13);
          longKeys[k * 4 + 2] = Math.sin(angle / 2);
          longKeys[k * 4 + 3] = Math.cos(angle / 2);
        }
      const sampler = d
        .createAnimationSampler()
        .setInput(times)
        .setOutput(kind === "skin-long" ? attr("VEC4", longKeys) : rotations)
        .setInterpolation("LINEAR");
      animation
        .addSampler(sampler)
        .addChannel(
          d
            .createAnimationChannel()
            .setTargetNode(joint)
            .setTargetPath("rotation")
            .setSampler(sampler),
        );
    }
    const skin = d
      .createSkin()
      .setSkeleton(joints[0])
      .setInverseBindMatrices(attr("MAT4", bind));
    for (const j of joints) skin.addJoint(j);
    node.setSkin(skin);
    const jointIndices = new Uint16Array(400 * 4),
      weights = new Float32Array(400 * 4);
    for (let i = 0; i < 400; i++) {
      jointIndices[i * 4 + 1] = 63;
      weights[i * 4] = weights[i * 4 + 1] = 0.5;
    }
    primitive
      .setAttribute("JOINTS_0", attr("VEC4", jointIndices))
      .setAttribute("WEIGHTS_0", attr("VEC4", weights));
  }
  d.createScene().addChild(root);
  await new NodeIO().write(`public/regression/crowd-${kind}.glb`, d);
}
