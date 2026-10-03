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

// Deterministic RGBA PNGs keep the regression fixture independent of image tools.
const { deflateSync } = await import("node:zlib");
function png(width, height, pixels) {
  const chunk = (type, data) => {
    const name = Buffer.from(type),
      body = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    const header = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++)
    Buffer.from(pixels.slice(y * width * 4, (y + 1) * width * 4)).copy(
      rows,
      y * (1 + width * 4) + 1,
    );
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
const pbr = new Document(),
  pb = pbr.createBuffer();
const attr = (type, values) =>
  pbr
    .createAccessor()
    .setType(type)
    .setArray(new Float32Array(values))
    .setBuffer(pb);
const image = (name, color) =>
  pbr
    .createTexture(name)
    .setMimeType("image/png")
    .setImage(png(1, 1, color));
const pm = pbr
  .createMaterial("All five PBR maps")
  .setBaseColorFactor([0, 0, 0, 1])
  .setMetallicFactor(1)
  .setEmissiveFactor([1, 1, 1])
  .setBaseColorTexture(image("Base color", [128, 128, 128, 255]))
  .setMetallicRoughnessTexture(
    image("Roughness G, metal B", [255, 128, 255, 255]),
  )
  .setNormalTexture(image("Tilted tangent normal", [220, 128, 220, 255]))
  .setOcclusionTexture(image("Occlusion", [0, 0, 0, 255]))
  .setEmissiveTexture(
    pbr
      .createTexture("Emissive UV selection")
      .setMimeType("image/png")
      .setImage(png(2, 1, [128, 64, 32, 255, 32, 128, 64, 255])),
  );
for (const info of [
  pm.getBaseColorTextureInfo(),
  pm.getMetallicRoughnessTextureInfo(),
  pm.getNormalTextureInfo(),
  pm.getOcclusionTextureInfo(),
  pm.getEmissiveTextureInfo(),
])
  info.setMagFilter(9728).setMinFilter(9728);
const pp = pbr
  .createPrimitive()
  .setAttribute("POSITION", attr("VEC3", [-1, -1, 0, 1, -1, 0, 0, 1, 0]))
  .setAttribute("NORMAL", attr("VEC3", [0, 0, 1, 0, 0, 1, 0, 0, 1]))
  .setAttribute("TANGENT", attr("VEC4", [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]))
  .setAttribute("TEXCOORD_0", attr("VEC2", [0.25, 0.5, 0.25, 0.5, 0.25, 0.5]))
  .setAttribute("TEXCOORD_1", attr("VEC2", [0.75, 0.5, 0.75, 0.5, 0.75, 0.5]))
  .setMaterial(pm);
pbr
  .getRoot()
  .setDefaultScene(
    pbr
      .createScene()
      .addChild(pbr.createNode().setMesh(pbr.createMesh().addPrimitive(pp))),
  );
await new NodeIO().write("public/regression/pbr.glb", pbr);

const animatedNode = pbr.getRoot().listNodes()[0];
pp.addTarget(
  pbr
    .createPrimitiveTarget()
    .setAttribute("POSITION", attr("VEC3", [0, 0, 1, 0, 0, 1, 0, 0, 1])),
);
animatedNode.getMesh().setWeights([0.2]);
animatedNode.setWeights([0.1]);
const animation = pbr.createAnimation("TRS and morph");
for (const [path, type, values] of [
  ["translation", "VEC3", [0, 0, 0, 10, 0, 0]],
  ["rotation", "VEC4", [0, 0, 0, 1, 0, 0, 1, 0]],
  ["scale", "VEC3", [1, 1, 1, 0.5, 0.5, 0.5]],
  ["weights", "SCALAR", [0, 1]],
]) {
  const sampler = pbr
    .createAnimationSampler()
    .setInterpolation("LINEAR")
    .setInput(attr("SCALAR", [0, 1]))
    .setOutput(attr(type, values));
  animation
    .addSampler(sampler)
    .addChannel(
      pbr
        .createAnimationChannel()
        .setTargetNode(animatedNode)
        .setTargetPath(path)
        .setSampler(sampler),
    );
}
await new NodeIO().write("public/regression/animated.glb", pbr);

const jointRoot = pbr.createNode("Joint root"),
  jointTip = pbr.createNode("Joint tip").setTranslation([0, 1, 0]);
jointRoot.addChild(jointTip);
pbr.getRoot().getDefaultScene().addChild(jointRoot);
const binds = new Float32Array(32);
for (let j = 0; j < 2; j++)
  binds[j * 16] =
    binds[j * 16 + 5] =
    binds[j * 16 + 10] =
    binds[j * 16 + 15] =
      1;
binds[16 + 13] = -1;
const skin = pbr
  .createSkin("Shared two-joint skin")
  .setSkeleton(jointRoot)
  .addJoint(jointRoot)
  .addJoint(jointTip)
  .setInverseBindMatrices(
    pbr.createAccessor().setType("MAT4").setArray(binds).setBuffer(pb),
  );
pp.setAttribute(
  "JOINTS_0",
  pbr
    .createAccessor()
    .setType("VEC4")
    .setArray(new Uint8Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]))
    .setBuffer(pb),
);
pp.setAttribute(
  "WEIGHTS_0",
  pbr
    .createAccessor()
    .setType("VEC4")
    .setArray(new Uint8Array([128, 127, 0, 0, 128, 127, 0, 0, 128, 127, 0, 0]))
    .setNormalized(true)
    .setBuffer(pb),
);
animatedNode.setSkin(skin);
pbr
  .getRoot()
  .getDefaultScene()
  .addChild(
    pbr
      .createNode("Second skin instance")
      .setMesh(animatedNode.getMesh())
      .setSkin(skin)
      .setTranslation([4, 0, 0]),
  );
await new NodeIO().write("public/regression/skinned.glb", pbr);

const blend = pbr.createAnimation("Crossfade target");
for (const [path, type, values] of [
  ["translation", "VEC3", [-10, 0, 0, -10, 0, 0]],
  ["rotation", "VEC4", [0, 0, 0, 1, 0, 0, 0, 1]],
  ["scale", "VEC3", [0.25, 0.25, 0.25, 0.25, 0.25, 0.25]],
  ["weights", "SCALAR", [1, 1]],
]) {
  const sampler = pbr
    .createAnimationSampler()
    .setInput(attr("SCALAR", [0, 1]))
    .setOutput(attr(type, values));
  blend
    .addSampler(sampler)
    .addChannel(
      pbr
        .createAnimationChannel()
        .setTargetNode(animatedNode)
        .setTargetPath(path)
        .setSampler(sampler),
    );
}
await new NodeIO().write("public/regression/blending.glb", pbr);

// Native BC1 fixture with a complete authored mip chain, matching solid red RGBA.
const {
  createDefaultContainer,
  write: writeKTX,
  VK_FORMAT_BC1_RGBA_UNORM_BLOCK,
} = await import("ktx-parse");
const nativeBC = createDefaultContainer();
nativeBC.vkFormat = VK_FORMAT_BC1_RGBA_UNORM_BLOCK;
nativeBC.pixelWidth = nativeBC.pixelHeight = 8;
nativeBC.levelCount = 4;
const bcDFD = nativeBC.dataFormatDescriptor[0];
bcDFD.colorModel = 128;
bcDFD.texelBlockDimension = [3, 3, 0, 0];
bcDFD.bytesPlane = [8, 0, 0, 0, 0, 0, 0, 0];
bcDFD.samples = [0, 1].map((channelType) => ({
  bitOffset: 0,
  bitLength: 63,
  channelType,
  samplePosition: [0, 0, 0, 0],
  sampleLower: 0,
  sampleUpper: 0xffffffff,
}));
nativeBC.levels = [4, 1, 1, 1].map((blocks) => {
  const levelData = new Uint8Array(blocks * 8);
  for (let i = 0; i < blocks; i++) {
    levelData[i * 8 + 1] = 0xf8;
    levelData[i * 8 + 3] = 0xf8;
  }
  return { levelData, uncompressedByteLength: levelData.length };
});
await (
  await import("node:fs/promises")
).writeFile("public/regression/native-bc1.ktx2", writeKTX(nativeBC));
