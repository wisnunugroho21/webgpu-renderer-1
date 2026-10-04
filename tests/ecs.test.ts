import { describe, expect, it } from "vitest";
import { World } from "../src/ecs/World";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
describe("data oriented world and dirty transforms", () => {
  // Groups checks for data oriented world and dirty transforms.

  it("creates numeric monotonic entities and queries component intersections", () => {
    // Verifies creates numeric monotonic entities and queries component intersections.

    const w = new World(4),
      a = w.create(),
      b = w.create();
    expect(typeof a).toBe("number");
    w.transforms.add(a);
    w.transforms.add(b);
    w.meshes.set(b, 2, 3);
    const out = new Uint32Array(4);
    expect(w.query(out, w.transforms, w.meshes)).toBe(1);
    expect(out[0]).toBe(b);
    w.destroy(a);
    expect(w.create()).not.toBe(a);
    expect(w.count).toBe(2);
    w.create();
    expect(() =>
      /** Delegates this operation to w.create. */ w.create(),
    ).toThrow("capacity");
    expect(() =>
      /** Delegates this operation to w.query. */ w.query(
        new Uint32Array(0),
        w.transforms,
      ),
    ).toThrow("capacity");
  });
  it("updates exactly 100 dirty transforms among 10,000 and preserves the others", () => {
    // Verifies updates exactly 100 dirty transforms among 10,000 and preserves the others.

    const w = new World(10000),
      system = new TransformSystem(w.capacity);
    for (let i = 0; i < 10000; i++) {
      w.transforms.add(w.create());
      w.transforms.setPosition(i, i, 0, 0);
    }
    expect(system.update(w.transforms)).toBe(10000);
    const previous = w.transforms.worldMatrices.slice();
    for (let i = 0; i < 100; i++) w.transforms.setPosition(i, i, 1, 0);
    expect(system.update(w.transforms)).toBe(100);
    expect(system.update(w.transforms)).toBe(0);
    expect(w.transforms.worldMatrices.subarray(1600)).toEqual(
      previous.subarray(1600),
    );
  });
  it("propagates changes to descendants and resolves parent updates first", () => {
    // Verifies propagates changes to descendants and resolves parent updates first.

    const w = new World(5),
      system = new TransformSystem(5),
      child = w.create(),
      parent = w.create(),
      other = w.create();
    for (const e of [child, parent, other]) w.transforms.add(e);
    w.transforms.setParent(child, parent);
    w.transforms.setPosition(parent, 2, 0, 0);
    w.transforms.setPosition(child, 3, 0, 0);
    expect(system.update(w.transforms)).toBe(3);
    expect(w.transforms.worldMatrices[child * 16 + 12]).toBe(5);
    w.transforms.setPosition(parent, 4, 0, 0);
    w.transforms.setPosition(parent, 4, 0, 0);
    expect(system.update(w.transforms)).toBe(2);
    expect(w.transforms.worldMatrices[child * 16 + 12]).toBe(7);
    expect(() =>
      /** Delegates this operation to w.transforms.setParent. */ w.transforms.setParent(
        parent,
        child,
      ),
    ).toThrow("cycle");
  });
  it("detaches children on parent destruction, preserving their local transforms", () => {
    // Verifies detaches children on parent destruction, preserving their local transforms.

    const w = new World(4),
      system = new TransformSystem(4),
      parent = w.create(),
      child = w.create();
    w.transforms.add(parent);
    w.transforms.add(child);
    w.transforms.setParent(child, parent);
    w.transforms.setPosition(parent, 5, 0, 0);
    w.transforms.setPosition(child, 2, 0, 0);
    system.update(w.transforms);
    w.destroy(parent);
    expect(w.transforms.parent[child]).toBe(-1);
    expect(system.update(w.transforms)).toBe(1);
    expect(w.transforms.worldMatrices[child * 16 + 12]).toBe(2);
  });
  it("reparents sibling lists correctly and handles component removal/readdition", () => {
    // Verifies reparents sibling lists correctly and handles component removal/readdition.

    const w = new World(4),
      system = new TransformSystem(4);
    for (let i = 0; i < 4; i++) w.transforms.add(w.create());
    w.transforms.setParent(1, 0);
    w.transforms.setParent(2, 0);
    w.transforms.setParent(3, 0);
    system.update(w.transforms);
    w.transforms.setParent(2, 1);
    expect(w.transforms.nextSibling[3]).toBe(1);
    expect(w.transforms.firstChild[1]).toBe(2);
    w.transforms.remove(2);
    w.transforms.add(2);
    w.transforms.remove(2);
    w.transforms.add(2);
    expect(w.transforms.dirtyCount).toBeLessThanOrEqual(4);
    expect(system.update(w.transforms)).toBe(1);
    expect(w.transforms.worldMatrices[2 * 16]).toBe(1);
  });
  it("updates deep hierarchies without recursive stack overflow", () => {
    // Verifies updates deep hierarchies without recursive stack overflow.

    const w = new World(10000),
      system = new TransformSystem(10000);
    for (let i = 0; i < 10000; i++) {
      w.transforms.add(w.create());
      w.transforms.setPosition(i, 1, 0, 0);
      if (i) w.transforms.setParent(i, i - 1);
    }
    expect(system.update(w.transforms)).toBe(10000);
    expect(w.transforms.worldMatrices[9999 * 16 + 12]).toBe(10000);
    w.transforms.setPosition(0, 2, 0, 0);
    expect(system.update(w.transforms)).toBe(10000);
    expect(w.transforms.worldMatrices[9999 * 16 + 12]).toBe(10001);
  });
});
