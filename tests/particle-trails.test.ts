import { describe, expect, it } from "vitest";
import { ParticleSystem } from "../src/particles/ParticleSystem";
import { PARTICLE_WORDS } from "../src/particles/ParticleLayout";

describe("bounded particle ribbons", () => {
  // Exercise public history behavior and the retained renderer snapshot together.
  it("evicts oldest points and preserves joined neighbors without clock-only repacking", () => {
    // The ring must retain chronological connectivity after wraparound.
    const system = new ParticleSystem(8, 2, { capacity: 1, pointsPerTrail: 3 });
    system.enabled = true;
    const trail = system.createTrail({ lifetime: 2, minDistance: 0.1 });
    expect(trail.addPoint(0, 0, 0)).toBe(true);
    expect(trail.addPoint(0.01, 0, 0)).toBe(false);
    trail.addPoint(1, 0, 0);
    trail.addPoint(1, 1, 0);
    trail.addPoint(2, 1, 0);
    system.trails.prepare();
    const records = system.trails.records;
    expect(system.trails.count).toBe(2);
    expect(Array.from(records.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(records.slice(4, 7))).toEqual([1, 1, 0]);
    expect(Array.from(records.slice(28, 31))).toEqual([2, 1, 0]);
    expect(
      Array.from(records.slice(PARTICLE_WORDS + 8, PARTICLE_WORDS + 11)),
    ).toEqual([1, 0, 0]);
    const revision = system.trails.revision;
    system.update(0.5);
    system.trails.prepare();
    expect(system.trails.revision).toBe(revision);
    expect(system.trails.records).toBe(records);
    system.enabled = false;
    system.update(5);
    expect(trail.count).toBe(3);
    expect(trail.addPoint(3, 1, 0)).toBe(false);
    system.enabled = true;
    system.update(1.5);
    system.trails.prepare();
    expect(system.trails.count).toBe(0);
  });
  it("isolates clearing, rejects invalid input atomically, and recycles controller slots", () => {
    // Scene teardown must release controllers without corrupting other active effects.
    const system = new ParticleSystem(8, 2, { capacity: 2, pointsPerTrail: 4 });
    system.enabled = true;
    const a = system.createTrail(),
      b = system.createTrail();
    a.addPoint(0, 0, 0);
    a.addPoint(1, 0, 0);
    b.addPoint(0, 1, 0);
    b.addPoint(1, 1, 0);
    expect(() => {
      /* Fail before any retained point mutation. */ a.addPoint(NaN, 0, 0);
    }).toThrow();
    expect(a.count).toBe(2);
    expect(() => {
      /* The fixed controller pool cannot grow. */ system.createTrail();
    }).toThrow();
    a.clear();
    system.trails.prepare();
    expect(system.trails.count).toBe(1);
    a.dispose();
    a.dispose();
    expect(() => {
      /* Retired controllers cannot append samples. */ a.addPoint(0, 0, 0);
    }).toThrow();
    const replacement = system.createTrail();
    replacement.addPoint(0, 2, 0);
    replacement.addPoint(1, 2, 0);
    system.clear();
    expect(b.count).toBe(0);
    expect(replacement.count).toBe(0);
    system.dispose();
    expect(b.disposed).toBe(true);
  });
  it("rejects oversized histories and unknown curve references before installation", () => {
    // Invalid cold settings must not reserve a reusable slot.
    const system = new ParticleSystem(1, 1, { capacity: 1, pointsPerTrail: 4 });
    expect(() => {
      /* Bound point storage before allocation. */ system.createTrail({
        maxPoints: 5,
      });
    }).toThrow();
    expect(() => {
      /* Profiles must already be installed. */ system.createTrail({
        curve: 1,
      });
    }).toThrow();
    expect(() => {
      /* Avoid invalid distances in the append hot path. */ system.createTrail({
        minDistance: 0,
      });
    }).toThrow();
    expect(system.trails.installed).toBe(false);
    expect(system.createTrail().maxPoints).toBe(4);
  });
});
