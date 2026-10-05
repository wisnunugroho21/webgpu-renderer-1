import { Document, NodeIO } from "@gltf-transform/core";
import {
  KHRMaterialsClearcoat,
  KHRMaterialsIOR,
  KHRMaterialsSpecular,
  KHRMaterialsEmissiveStrength,
  KHRTextureTransform,
} from "@gltf-transform/extensions";
// Deterministic RGBA PNGs keep the regression fixture independent of image tools.
const { deflateSync } = await import("node:zlib");
/** Builds a deterministic PNG fixture from raw pixel bytes. */
function png(width, height, pixels) {
  /** Encodes a PNG chunk with its length, type, payload and CRC. */
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

/** Build a deterministic authored material fixture, including every extension map and UV transform. */
export async function authoredFixture(path) {
  const d = new Document(),
    buffer = d.createBuffer();
  const attr = (type, values) =>
    /** Build a float accessor in the fixture-owned buffer. */ d
      .createAccessor()
      .setType(type)
      .setArray(new Float32Array(values))
      .setBuffer(buffer);
  const image = (rgba) =>
    /** Encode a deterministic one-pixel texture for channel references. */ d
      .createTexture()
      .setMimeType("image/png")
      .setImage(png(1, 1, rgba));
  const coat = d
    .createExtension(KHRMaterialsClearcoat)
    .createClearcoat()
    .setClearcoatFactor(0.8)
    .setClearcoatRoughnessFactor(0.15)
    .setClearcoatTexture(image([192, 0, 0, 255]))
    .setClearcoatRoughnessTexture(image([0, 128, 0, 255]))
    .setClearcoatNormalTexture(image([180, 128, 240, 255]));
  const spec = d
    .createExtension(KHRMaterialsSpecular)
    .createSpecular()
    .setSpecularFactor(0.7)
    .setSpecularColorFactor([1, 0.6, 0.3])
    .setSpecularTexture(image([0, 0, 0, 128]))
    .setSpecularColorTexture(image([128, 192, 255, 255]));
  const m = d
    .createMaterial()
    .setBaseColorFactor([0.3, 0.4, 0.5, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.4)
    .setEmissiveFactor([0.01, 0.02, 0.03])
    .setExtension("KHR_materials_clearcoat", coat)
    .setExtension("KHR_materials_specular", spec)
    .setExtension(
      "KHR_materials_ior",
      d.createExtension(KHRMaterialsIOR).createIOR().setIOR(1.33),
    )
    .setExtension(
      "KHR_materials_emissive_strength",
      d
        .createExtension(KHRMaterialsEmissiveStrength)
        .createEmissiveStrength()
        .setEmissiveStrength(3),
    );
  m.setAlphaMode("MASK").setBaseColorTexture(
    d
      .createTexture()
      .setMimeType("image/png")
      .setImage(
        png(
          4,
          1,
          [
            255, 255, 255, 255, 255, 0, 0, 0, 0, 255, 0, 255, 255, 255, 255,
            255,
          ],
        ),
      ),
  );
  const transform = d.createExtension(KHRTextureTransform);
  for (const info of [
    m.getBaseColorTextureInfo(),
    coat.getClearcoatTextureInfo(),
    coat.getClearcoatRoughnessTextureInfo(),
    coat.getClearcoatNormalTextureInfo(),
    spec.getSpecularTextureInfo(),
    spec.getSpecularColorTextureInfo(),
  ])
    info.setExtension(
      "KHR_texture_transform",
      transform
        .createTransform()
        .setRotation(0.2)
        .setScale([0.8, 0.8])
        .setOffset([0.1, 0.1]),
    );
  const primitive = d
    .createPrimitive()
    .setAttribute(
      "POSITION",
      attr("VEC3", [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    )
    .setAttribute("NORMAL", attr("VEC3", [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]))
    .setAttribute(
      "TANGENT",
      attr("VEC4", [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]),
    )
    .setAttribute("TEXCOORD_0", attr("VEC2", [0, 0, 1, 0, 1, 1, 0, 1]))
    .setIndices(
      d
        .createAccessor()
        .setType("SCALAR")
        .setArray(new Uint16Array([0, 1, 2, 0, 2, 3]))
        .setBuffer(buffer),
    )
    .setMaterial(m);
  d.getRoot().setDefaultScene(
    d
      .createScene()
      .addChild(d.createNode().setMesh(d.createMesh().addPrimitive(primitive))),
  );
  await new NodeIO()
    .registerExtensions([
      KHRMaterialsClearcoat,
      KHRMaterialsIOR,
      KHRMaterialsSpecular,
      KHRMaterialsEmissiveStrength,
      KHRTextureTransform,
    ])
    .write(path, d);
}
