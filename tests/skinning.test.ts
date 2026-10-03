import { describe, it, expect } from "vitest";
import { SkeletonAsset } from "../src/animation/skinning/SkeletonAsset";
import { SkeletonInstance } from "../src/animation/skinning/SkeletonInstance";
import { SkinVertexData } from "../src/animation/skinning/SkinVertexData";
import {
  RuntimeAsset,
  RuntimePrimitive,
} from "../src/assets/gltf/RuntimeAsset";
import { Mat4 } from "../src/math/Mat4";
const nodes = () =>
  Array.from({ length: 3 }, (_, i) => ({
    children: new Uint32Array(i < 2 ? [i + 1] : []),
  })) as RuntimeAsset["nodes"];
const skin = () => ({
  joints: new Uint32Array([0, 2]),
  inverseBindMatrices: new Float32Array([...Mat4.create(), ...Mat4.create()]),
  skeleton: 0,
});
describe("skeleton assets and instances", () => {
  it("finds joint parents through non-joint nodes and shares bind data", () => {
    const asset = new SkeletonAsset(skin(), nodes());
    expect(asset.parents).toEqual(new Int32Array([-1, 0]));
    const entities = new Int32Array([10, 11, 12]),
      a = new SkeletonInstance(asset, 20, entities),
      b = new SkeletonInstance(asset, 21, entities);
    expect(a.asset).toBe(b.asset);
    expect(a.jointEntities).toEqual(new Int32Array([10, 12]));
    expect(a.matrices).not.toBe(b.matrices);
    a.matrices[12] = 1;
    expect(b.matrices[12]).toBe(0);
    expect(a.jointOffset).toBe(-1);
  });
  it("rejects invalid bind counts, duplicate/unknown joints and missing runtime nodes", () => {
    expect(
      () =>
        new SkeletonAsset(
          { ...skin(), joints: new Uint32Array([0, 0]) },
          nodes(),
        ),
    ).toThrow();
    expect(
      () =>
        new SkeletonAsset(
          { ...skin(), inverseBindMatrices: new Float32Array(16) },
          nodes(),
        ),
    ).toThrow();
    expect(
      () =>
        new SkeletonAsset(
          { ...skin(), joints: new Uint32Array([0, 10]) },
          nodes(),
        ),
    ).toThrow();
    const s = new SkeletonAsset(skin(), nodes());
    expect(
      () => new SkeletonInstance(s, 1, new Int32Array([0, 1, -1])),
    ).toThrow();
  });
});
describe("static skin influences", () => {
  const primitive = (
    attributes: Record<string, Float32Array>,
  ): RuntimePrimitive => ({
    mode: 0,
    indices: new Uint32Array([0]),
    material: 0,
    targets: [],
    attributes: { POSITION: new Float32Array(3), ...attributes },
  });
  it("retains and normalizes both influence sets with one total weight", () => {
    const data = SkinVertexData.fromPrimitive(
      primitive({
        JOINTS_0: new Float32Array([0, 1, 0, 0]),
        WEIGHTS_0: new Float32Array([2, 1, 0, 0]),
        JOINTS_1: new Float32Array([2, 3, 0, 0]),
        WEIGHTS_1: new Float32Array([1, 0, 0, 0]),
      }),
    )!;
    expect(data.primary.weights).toEqual(new Float32Array([0.5, 0.25, 0, 0]));
    expect(data.secondary?.weights).toEqual(new Float32Array([0.25, 0, 0, 0]));
    data.validateJointCount(4);
    expect(() => data.validateJointCount(3)).toThrow();
  });
  it("rejects malformed attributes, bad joint indices and zero weights", () => {
    expect(SkinVertexData.fromPrimitive(primitive({}))).toBeUndefined();
    expect(() =>
      SkinVertexData.fromPrimitive(
        primitive({ JOINTS_0: new Float32Array(4) }),
      ),
    ).toThrow();
    for (const j of [-1, 0.5, Infinity])
      expect(() =>
        SkinVertexData.fromPrimitive(
          primitive({
            JOINTS_0: new Float32Array([j, 0, 0, 0]),
            WEIGHTS_0: new Float32Array([1, 0, 0, 0]),
          }),
        ),
      ).toThrow();
    expect(() =>
      SkinVertexData.fromPrimitive(
        primitive({
          JOINTS_0: new Float32Array(4),
          WEIGHTS_0: new Float32Array(4),
        }),
      ),
    ).toThrow();
  });
});

import { World } from "../src/ecs/World";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
import { SkeletonSystem } from "../src/ecs/systems/SkeletonSystem";
import { SkeletonRegistry } from "../src/animation/skinning/SkeletonRegistry";
describe("mesh-relative skeleton updates", () => {
  const rig = () => {
    const world = new World(4),
      mesh = world.create(),
      root = world.create(),
      tip = world.create();
    for (const e of [mesh, root, tip]) world.transforms.add(e);
    world.transforms.setPosition(mesh, 10, 0, 0);
    world.transforms.setScale(mesh, 2, 2, 2);
    world.transforms.setPosition(root, 3, 0, 0);
    world.transforms.setParent(tip, root);
    world.transforms.setPosition(tip, 0, 1, 0);
    const bind0 = Mat4.create(),
      bind1 = Mat4.create();
    bind0[12] = -1;
    bind1[12] = -1;
    bind1[13] = -1;
    const asset = new SkeletonAsset(
      {
        joints: new Uint32Array([0, 2]),
        inverseBindMatrices: new Float32Array([...bind0, ...bind1]),
        skeleton: 0,
      },
      nodes(),
    );
    const instance = new SkeletonInstance(
        asset,
        mesh,
        new Int32Array([root, -1, tip]),
      ),
      registry = new SkeletonRegistry();
    registry.instances.push(instance);
    const transforms = new TransformSystem(4),
      system = new SkeletonSystem();
    transforms.update(world.transforms);
    return { world, mesh, root, tip, instance, registry, transforms, system };
  };
  it("applies inverse mesh * joint world * inverse bind in column-vector order", () => {
    const { world, mesh, instance, registry, system } = rig();
    system.update(world, registry);
    expect(instance.matrices[0]).toBe(0.5);
    expect(instance.matrices[12]).toBe(-4);
    const local = new Float32Array(3),
      global = new Float32Array(3);
    Mat4.transformPoint(local, instance.matrixViews[0]!, [1, 0, 0]);
    Mat4.transformPoint(
      global,
      world.transforms.worldMatrices.subarray(mesh * 16, mesh * 16 + 16),
      local,
    );
    expect(Array.from(global)).toEqual([3, 0, 0]);
    expect(system.updatedJoints).toBe(2);
  });
  it("updates only changed joint ranges and propagates joint/mesh motion", () => {
    const { world, mesh, tip, instance, registry, transforms, system } = rig();
    system.update(world, registry);
    instance.dirtyJoints.fill(0);
    system.update(world, registry);
    expect(system.updatedJoints).toBe(0);
    expect(instance.dirtyJoints).toEqual(new Uint8Array(2));
    world.transforms.setPosition(tip, 0, 2, 0);
    transforms.update(world.transforms);
    system.update(world, registry);
    expect(system.updatedJoints).toBe(1);
    expect(instance.matrices[16 + 13]).toBe(0.5);
    world.transforms.setPosition(mesh, 12, 0, 0);
    transforms.update(world.transforms);
    system.update(world, registry);
    expect(system.updatedJoints).toBe(2);
    expect(instance.matrices[12]).toBe(-5);
  });
  it("rejects singular mesh transforms and removed live joints", () => {
    const { world, mesh, root, registry, transforms, system } = rig();
    world.transforms.setScale(mesh, 0, 1, 1);
    transforms.update(world.transforms);
    expect(() => system.update(world, registry)).toThrow("Singular");
    world.transforms.setScale(mesh, 1, 1, 1);
    transforms.update(world.transforms);
    world.destroy(root);
    expect(() => system.update(world, registry)).toThrow("removed");
  });
  it("inverts affine and projective matrices in place", () => {
    const p = Mat4.create();
    Mat4.perspective(p, Math.PI / 3, 1.5, 0.1, 100);
    const inverse = p.slice();
    Mat4.invert(inverse, inverse);
    const identity = Mat4.create();
    Mat4.multiply(identity, p, inverse);
    for (let i = 0; i < 16; i++)
      expect(identity[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 5);
  });
  it("rejects cycles containing joints", () => {
    const n = nodes();
    n[2]!.children = new Uint32Array([0]);
    expect(() => new SkeletonAsset(skin(), n)).toThrow("cycle");
  });
});
