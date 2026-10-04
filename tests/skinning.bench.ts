import { bench, describe } from "vitest";
import { SkinVertexData } from "../src/animation/skinning/SkinVertexData";
const vertices = 10000,
  weights = new Float32Array(vertices * 4),
  joints = new Float32Array(vertices * 4);
for (let v = 0; v < vertices; v++) {
  weights[v * 4] = 0.5;
  weights[v * 4 + 1] = 0.5;
  joints[v * 4] = v % 64;
  joints[v * 4 + 1] = (v + 1) % 64;
}
const primitive = {
  mode: 4,
  indices: new Uint32Array([0, 1, 2]),
  material: 0,
  targets: [],
  attributes: {
    POSITION: new Float32Array(vertices * 3),
    JOINTS_0: joints,
    WEIGHTS_0: weights,
  },
};
describe("Phase 17 static skin data", () => {
  bench("validate/copy/normalize 10,000 eight-weight vertices", () => {
    SkinVertexData.fromPrimitive({
      ...primitive,
      attributes: {
        ...primitive.attributes,
        JOINTS_1: joints,
        WEIGHTS_1: weights,
      },
    })!.validateJointCount(64);
  });
  bench("validate/copy/normalize 10,000 four-weight vertices", () => {
    SkinVertexData.fromPrimitive(primitive)!.validateJointCount(64);
  });
});

import { World } from "../src/ecs/World";
import { Mat4 } from "../src/math/Mat4";
import { SkeletonAsset } from "../src/animation/skinning/SkeletonAsset";
import { SkeletonInstance } from "../src/animation/skinning/SkeletonInstance";
import { SkeletonRegistry } from "../src/animation/skinning/SkeletonRegistry";
import { SkeletonSystem } from "../src/ecs/systems/SkeletonSystem";
import { RuntimeAsset } from "../src/assets/gltf/RuntimeAsset";
const w = new World(6500),
  registry = new SkeletonRegistry(),
  system = new SkeletonSystem();
const ns = Array.from({ length: 64 }, () => ({
  children: new Uint32Array(),
})) as RuntimeAsset["nodes"];
const bind = new Float32Array(64 * 16);
for (let j = 0; j < 64; j++) bind.set(Mat4.create(), j * 16);
const asset = new SkeletonAsset(
  {
    joints: Uint32Array.from({ length: 64 }, (_, i) => i),
    inverseBindMatrices: bind,
    skeleton: 0,
  },
  ns,
);
for (let i = 0; i < 100; i++) {
  const mesh = w.create();
  w.transforms.add(mesh);
  w.transforms.worldMatrices.set(Mat4.create(), mesh * 16);
  const entities = new Int32Array(64);
  for (let j = 0; j < 64; j++) {
    const e = w.create();
    w.transforms.add(e);
    entities[j] = e;
    w.transforms.worldMatrices.set(Mat4.create(), e * 16);
  }
  registry.instances.push(new SkeletonInstance(asset, mesh, entities));
}
system.update(w, registry);
let pose = 0;
describe("Phase 18 skeleton palettes: 100 x 64 joints", () => {
  bench("unchanged poses", () => system.update(w, registry));
  bench("all poses changed", () => {
    pose = pose ? 0 : 1;
    for (const instance of registry.instances)
      for (const e of instance.jointEntities)
        w.transforms.worldMatrices[e * 16 + 12] = pose;
    system.update(w, registry);
  });
});
