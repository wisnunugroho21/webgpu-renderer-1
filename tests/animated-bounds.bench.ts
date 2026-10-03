import { bench, describe } from "vitest";
import { AnimatedBoundsSystem } from "../src/ecs/systems/AnimatedBoundsSystem";
import { World } from "../src/ecs/World";
import { MeshManager } from "../src/rendering/MeshManager";
import { SkeletonRegistry } from "../src/animation/skinning/SkeletonRegistry";
import { SkeletonAsset } from "../src/animation/skinning/SkeletonAsset";
import { SkeletonInstance } from "../src/animation/skinning/SkeletonInstance";
import { MorphStatePool } from "../src/animation/MorphStatePool";
import { Mat4 } from "../src/math/Mat4";
import { RuntimeAsset } from "../src/assets/gltf/RuntimeAsset";
const world = new World(100),
  skeletons = new SkeletonRegistry(),
  morphs = new MorphStatePool(),
  system = new AnimatedBoundsSystem(),
  nodes = Array.from({ length: 64 }, () => ({
    children: new Uint32Array(),
  })) as RuntimeAsset["nodes"];
const bind = new Float32Array(1024);
for (let j = 0; j < 64; j++) bind.set(Mat4.create(), j * 16);
const bounds = {
  min: new Float32Array([-1, -1, -1]),
  max: new Float32Array([1, 1, 1]),
};
const boundsMesh = { bounds };
const asset = new SkeletonAsset(
    {
      joints: Uint32Array.from({ length: 64 }, (_, i) => i),
      inverseBindMatrices: bind,
      skeleton: 0,
    },
    nodes,
  ),
  meshes = { get: () => boundsMesh } as unknown as MeshManager;
for (let i = 0; i < 100; i++) {
  const e = world.create();
  world.transforms.add(e);
  world.meshes.set(e, 0, 0);
  world.bounds.setSphere(e, 0, 0, 0, 1);
  world.skins.add(e);
  world.skins.instanceId[e] = i;
  skeletons.instances.push(
    new SkeletonInstance(asset, e, new Int32Array(64).fill(e)),
  );
}
describe("Phase 25 conservative animated bounds", () => {
  bench("100 objects x 64 joint boxes; independent of vertex count", () =>
    system.update(world, meshes, skeletons, morphs),
  );
});
