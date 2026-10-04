import { describe, expect, it } from "vitest";
import { World } from "../src/ecs/World";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
import { CameraSystem } from "../src/ecs/systems/CameraSystem";
import { Camera } from "../src/rendering/Camera";
import { Animator } from "../src/animation/Animator";
import { AnimationClip } from "../src/animation/AnimationClip";
import { AnimationChannel } from "../src/animation/AnimationChannel";
import { AnimationSampler } from "../src/animation/AnimationSampler";

describe("recyclable entity handles", () => {
  it("reuses slots for thousands of lifetimes without reviving stale, forged or foreign handles", () => {
    const world = new World(2),
      foreign = new World(2).createHandle();
    const old = world.createHandle();
    expect(Object.isFrozen(old)).toBe(true);
    world.destroy(old);
    for (let i = 0; i < 10000; i++) {
      const next = world.createHandle();
      expect(next.index).toBe(old.index);
      expect(world.resolve(old)).toBe(null);
      expect(() => world.require(old)).toThrow("Stale");
      world.destroy(old); // must not destroy the replacement
      expect(world.resolve(next)).toBe(next.index);
      expect(world.resolve({ ...next })).toBe(null);
      expect(world.resolve(foreign)).toBe(null);
      world.destroy(next);
    }
    expect(world.nextEntity).toBe(1);
    expect(world.count).toBe(0);
  });
  it("never recycles legacy numeric IDs or allows legacy allocation to steal reusable slots", () => {
    const world = new World(3),
      legacy = world.create(),
      handle = world.createHandle();
    world.destroy(legacy);
    world.destroy(handle);
    expect(world.create()).toBe(2);
    expect(() => world.create()).toThrow("capacity");
    const next = world.createHandle();
    expect(next.index).toBe(handle.index);
    world.destroy(legacy);
    expect(world.resolve(next)).toBe(handle.index);
  });
  it("retires a slot at generation exhaustion rather than wrapping", () => {
    const world = new World(1),
      handle = world.createHandle();
    world.generation[handle.index] = Number.MAX_SAFE_INTEGER;
    world.destroy(handle.index);
    expect(world.availableHandleSlots).toBe(0);
    expect(() => world.createHandle()).toThrow("capacity");
  });
  it("cleans hierarchy, queued transforms and stale LOD/controller IDs on replacement", () => {
    const world = new World(2),
      system = new TransformSystem(2),
      parent = world.createHandle(),
      child = world.createHandle();
    for (const h of [parent, child]) world.transforms.add(world.require(h));
    world.transforms.setParent(child.index, parent.index);
    world.meshes.set(parent.index, 0, 0);
    world.meshes.setLOD(parent.index, 12);
    world.animators.add(parent.index);
    world.animators.animatorId[parent.index] = 5;
    world.skins.add(parent.index);
    world.skins.instanceId[parent.index] = 9;
    world.morphs.add(parent.index);
    world.morphs.stateId[parent.index] = 3;
    world.destroy(parent);
    const next = world.createHandle();
    world.transforms.add(world.require(next));
    world.transforms.setPosition(next.index, 7, 0, 0);
    world.meshes.set(next.index, 1, 1);
    expect(world.transforms.parent[child.index]).toBe(-1);
    expect(world.transforms.dirtyCount).toBeLessThanOrEqual(2);
    system.update(world.transforms);
    expect(world.transforms.worldMatrices[next.index * 16 + 12]).toBe(7);
    expect(world.meshes.lodGroup[next.index]).toBe(-1);
    expect(world.animators.animatorId[next.index]).toBe(-1);
    expect(world.skins.instanceId[next.index]).toBe(-1);
    expect(world.morphs.stateId[next.index]).toBe(-1);
  });
  it("does not animate or follow a replacement in a captured slot", () => {
    const world = new World(1),
      old = world.createHandle();
    world.transforms.add(old.index);
    world.cameras.setPerspective(old.index, {});
    const cameras = new CameraSystem();
    cameras.select(old.index, world);
    const clip = new AnimationClip("translation", [
      new AnimationChannel(
        0,
        "translation",
        new AnimationSampler(
          new Float32Array([0, 1]),
          new Float32Array([0, 0, 0, 9, 0, 0]),
          "LINEAR",
          false,
        ),
      ),
    ]);
    const animator = new Animator(
      [clip],
      world,
      new Int32Array([old.index]),
      new Map(),
    );
    animator.play();
    world.destroy(old);
    const next = world.createHandle();
    world.transforms.add(next.index);
    world.cameras.setPerspective(next.index, {});
    animator.update(0.5);
    cameras.update(world, new Camera());
    expect(world.transforms.positionX[next.index]).toBe(0);
    expect(cameras.activeEntity).toBe(null);
  });
});
