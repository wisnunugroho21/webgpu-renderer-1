import { describe, it, expect } from "vitest";
import { AnimatedBoundsSystem } from "../src/ecs/systems/AnimatedBoundsSystem";
import { MorphStatePool } from "../src/animation/MorphStatePool";
import { MorphTargetData } from "../src/animation/MorphTargetData";
import { SkeletonRegistry } from "../src/animation/skinning/SkeletonRegistry";
import { SkeletonInstance } from "../src/animation/skinning/SkeletonInstance";
import { SkeletonAsset } from "../src/animation/skinning/SkeletonAsset";
import { World } from "../src/ecs/World";
import { Mat4 } from "../src/math/Mat4";
import { RuntimeAsset } from "../src/assets/gltf/RuntimeAsset";
import { MeshManager } from "../src/rendering/MeshManager";
import { Camera } from "../src/rendering/Camera";
import { Frustum } from "../src/math/Frustum";
import { FrustumCuller } from "../src/visibility/FrustumCuller";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderExtractor } from "../src/rendering/RenderExtractor";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
const setup = () => {
  const world = new World(2),
    e = world.create();
  world.transforms.add(e);
  world.meshes.set(e, 0, 0);
  world.bounds.setAABB(e, [-1, -1, 0], [1, 1, 0]);
  const nodes = [
    { children: new Uint32Array() },
    { children: new Uint32Array() },
  ] as RuntimeAsset["nodes"];
  const asset = new SkeletonAsset(
      {
        joints: new Uint32Array([0, 1]),
        inverseBindMatrices: new Float32Array([
          ...Mat4.create(),
          ...Mat4.create(),
        ]),
        skeleton: 0,
      },
      nodes,
    ),
    instance = new SkeletonInstance(asset, e, new Int32Array([e, e])),
    skeletons = new SkeletonRegistry();
  instance.jointOffset = 0;
  skeletons.jointCount = 2;
  skeletons.instances.push(instance);
  world.skins.add(e);
  world.skins.instanceId[e] = 0;
  const morphs = new MorphStatePool(2),
    id = morphs.create(2, [0.5, -0.25]);
  world.morphs.add(e);
  world.morphs.stateId[e] = id;
  const morph = new MorphTargetData(
      [
        { POSITION: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]) },
        { POSITION: new Float32Array([0, 2, 0, 0, 2, 0, 0, 2, 0]) },
      ],
      3,
    ),
    mesh = {
      bounds: {
        min: new Float32Array([-1, -1, 0]),
        max: new Float32Array([1, 1, 0]),
      },
      morph,
    };
  const meshes = { get: () => mesh } as unknown as MeshManager;
  return {
    world,
    e,
    instance,
    skeletons,
    morphs,
    meshes,
    system: new AnimatedBoundsSystem(),
  };
};
describe("conservative animated bounds", () => {
  it("encloses all convex skin blends after positive and negative morph weights", () => {
    const { world, e, instance, skeletons, morphs, meshes, system } = setup();
    instance.matrixViews[1]![12] = 3;
    instance.matrixViews[1]![13] = -4;
    system.update(world, meshes, skeletons, morphs);
    expect(system.jointBoxes).toBe(2);
    expect(world.bounds.min[e * 3]).toBeLessThan(-0.5);
    expect(world.bounds.max[e * 3]).toBeGreaterThan(4.5);
    const a = new Float32Array(3),
      b = new Float32Array(3);
    for (const x of [-1, 0, 1])
      for (const y of [-1, 0, 1])
        for (const weight of [0, 0.1, 0.5, 0.9, 1]) {
          Mat4.transformPoint(a, instance.matrixViews[0]!, [
            x + 0.5,
            y - 0.5,
            0,
          ]);
          Mat4.transformPoint(b, instance.matrixViews[1]!, [
            x + 0.5,
            y - 0.5,
            0,
          ]);
          for (let axis = 0; axis < 3; axis++) {
            const value = a[axis]! * (1 - weight) + b[axis]! * weight;
            expect(value).toBeGreaterThanOrEqual(
              world.bounds.min[e * 3 + axis]!,
            );
            expect(value).toBeLessThanOrEqual(world.bounds.max[e * 3 + axis]!);
          }
        }
  });
  it("prevents bind-pose frustum rejection when the skin is visible elsewhere", () => {
    const { world, e, instance, skeletons, morphs, meshes, system } = setup();
    world.transforms.setPosition(e, 100, 0, 0);
    new TransformSystem(2).update(world.transforms);
    for (const m of instance.matrixViews) m[12] = -100;
    const camera = new Camera();
    camera.setPosition(0, 0, 5);
    camera.update(1);
    const f = new Frustum();
    f.setFromMatrix(camera.viewProjection);
    const out = new RenderWorld(2),
      extractor = new RenderExtractor(),
      culler = new FrustumCuller(2);
    extractor.extract(world, out, skeletons, morphs);
    expect(culler.cull(out, f)).toBe(0);
    system.update(world, meshes, skeletons, morphs);
    extractor.extract(world, out, skeletons, morphs);
    expect(culler.cull(out, f)).toBe(1);
  });
  it("handles morph-only bounds and skips static objects", () => {
    const { world, e, skeletons, morphs, meshes, system } = setup();
    world.skins.remove(e);
    system.update(world, meshes, skeletons, morphs);
    expect(world.bounds.min[e * 3]).toBeCloseTo(-0.5, 3);
    expect(world.bounds.min[e * 3 + 1]).toBeCloseTo(-1.5, 3);
    expect(system.jointBoxes).toBe(0);
    world.morphs.remove(e);
    system.update(world, meshes, skeletons, morphs);
    expect(system.updatedObjects).toBe(0);
  });
});
