import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { GLTFLoader } from "../src/assets/gltf/GLTFLoader";
function fixture(): Document {
  const d = new Document(),
    buffer = d.createBuffer(),
    position = d
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]))
      .setBuffer(buffer);
  const color = d
    .createAccessor()
    .setType("VEC4")
    .setArray(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]))
    .setNormalized(true)
    .setBuffer(buffer);
  const delta = d
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
    .setBuffer(buffer);
  const material = d
    .createMaterial()
    .setBaseColorFactor([0.7, 0.2, 1, 1])
    .setMetallicFactor(0.3)
    .setRoughnessFactor(0.6);
  const joints = d
      .createAccessor()
      .setType("VEC4")
      .setArray(new Uint16Array(12))
      .setBuffer(buffer),
    weights = d
      .createAccessor()
      .setType("VEC4")
      .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
      .setBuffer(buffer);
  const texture = d
    .createTexture("pixel")
    .setMimeType("image/png")
    .setImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  material.setBaseColorTexture(texture);
  material
    .getBaseColorTextureInfo()!
    .setMagFilter(9729)
    .setMinFilter(9987)
    .setWrapS(10497)
    .setWrapT(33071);
  const primitive = d
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setAttribute("COLOR_0", color)
    .setAttribute("JOINTS_0", joints)
    .setAttribute("WEIGHTS_0", weights)
    .setMaterial(material)
    .addTarget(d.createPrimitiveTarget().setAttribute("POSITION", delta));
  const mesh = d
      .createMesh("triangle")
      .addPrimitive(primitive)
      .setWeights([0.2]),
    node = d.createNode("mesh").setMesh(mesh).setWeights([0.7]);
  const joint = d.createNode("joint"),
    parent = d
      .createNode("parent")
      .setTranslation([2, 0, 0])
      .addChild(node)
      .addChild(joint);
  node.setSkin(d.createSkin().addJoint(joint).setSkeleton(joint));
  const camera = d
    .createCamera()
    .setType("perspective")
    .setYFov(Math.PI / 3)
    .setZNear(0.1)
    .setZFar(100);
  parent.setCamera(camera);
  const input = d
      .createAccessor()
      .setType("SCALAR")
      .setArray(new Float32Array([0, 1]))
      .setBuffer(buffer),
    output = d
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0]))
      .setBuffer(buffer);
  const sampler = d
    .createAnimationSampler()
    .setInput(input)
    .setOutput(output)
    .setInterpolation("LINEAR");
  d.createAnimation("move")
    .addSampler(sampler)
    .addChannel(
      d
        .createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath("translation")
        .setSampler(sampler),
    );
  const scene = d.createScene().addChild(parent);
  d.getRoot().setDefaultScene(scene);
  return d;
}
describe("glTF to independent engine assets", () => {
  it("reads GLB meshes, normalized attributes, hierarchy, materials, cameras, skin and morph data", async () => {
    const bytes = await new NodeIO().writeBinary(fixture()),
      asset = await new GLTFLoader().parseGLB(bytes);
    expect(asset.meshes[0]!.primitives[0]!.indices).toEqual(
      new Uint32Array([0, 1, 2]),
    );
    expect(asset.meshes[0]!.primitives[0]!.attributes.COLOR_0![0]).toBe(1);
    expect(asset.meshes[0]!.primitives[0]!.attributes.COLOR_0![1]).toBe(0);
    expect(asset.nodes.find((n) => n.name === "mesh")!.weights[0]).toBeCloseTo(
      0.7,
    );
    expect(asset.meshes[0]!.weights[0]).toBeCloseTo(0.2);
    expect(asset.meshes[0]!.primitives[0]!.targets[0]!.POSITION![2]).toBe(1);
    expect(asset.skins[0]!.joints.length).toBe(1);
    expect(Array.from(asset.skins[0]!.inverseBindMatrices)).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    expect(asset.animations[0]!.channels[0]!.interpolation).toBe("LINEAR");
    expect(asset.animations[0]!.channels[0]!.output[3]).toBe(1);
    expect(asset.cameras[0]!.near).toBeCloseTo(0.1);
    expect(asset.nodes.find((n) => n.name === "parent")!.children.length).toBe(
      2,
    );
    expect(asset.materials[0]!.roughness).toBeCloseTo(0.6);
    expect(asset.textures[0]!.image[0]).toBe(137);
    expect(asset.materials[0]!.textures.baseColor!.wrapT).toBe(33071);
    expect(asset.materials[0]!.textures.baseColor!.minFilter).toBe(9987);
    bytes.fill(0);
    expect(asset.meshes[0]!.primitives[0]!.attributes.POSITION![0]).toBe(-1);
  });
  it("reads JSON plus supplied buffer resources", async () => {
    const json = await new NodeIO().writeJSON(fixture()),
      asset = await new GLTFLoader().parseJSON(json);
    expect(asset.meshes[0]!.name).toBe("triangle");
    expect(asset.scenes.length).toBe(1);
  });
  it("rejects truncated or invalid GLB containers", async () => {
    const loader = new GLTFLoader();
    await expect(loader.parseGLB(new Uint8Array(4))).rejects.toThrow();
    const bytes = await new NodeIO().writeBinary(fixture());
    await expect(loader.parseGLB(bytes.slice(0, 20))).rejects.toThrow();
  });
});
