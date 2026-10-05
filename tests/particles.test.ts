import { describe, expect, it } from "vitest";
import { ParticleSystem } from "../src/particles/ParticleSystem";
import { PARTICLE_WORDS } from "../src/particles/ParticleOptions";

describe("bounded particle lifetimes and emission", () => {
  // Exercise CPU provenance independently of GPU rendering and device lifetime.
  it("starts disabled, bounds bursts and recycles expired rows", () => {
    // Overflow drops newest particles instead of allocating more storage or replaying a backlog.
    const system = new ParticleSystem(3);
    const emitter = system.createEmitter({ lifetime: [1, 1], rate: 10 });
    expect(emitter.burst(2)).toBe(0);
    system.enabled = true;
    expect(emitter.burst(5)).toBe(3);
    expect(system.count).toBe(3);
    expect(system.dropped).toBe(2);
    system.update(1);
    expect(system.count).toBe(3);
    expect(system.dropped).toBe(9);
    emitter.emitting = false;
    system.update(1);
    expect(system.count).toBe(0);
    expect(emitter.burst(1)).toBe(1);
    expect(system.records[3]).toBe(2);
  });
  it("accounts for all dropped requests during a large emission hitch", () => {
    // Spawn work stays bounded even when a long elapsed interval requests millions of particles.
    const system = new ParticleSystem(2);
    system.enabled = true;
    system.createEmitter({ rate: 1000000 });
    system.update(2);
    expect(system.count).toBe(2);
    expect(system.dropped).toBe(1999998);
    expect(system.records.length).toBe(2 * PARTICLE_WORDS);
  });
  it("preserves live records during motion and freezes when disabled", () => {
    // Analytic motion requires only a changing clock; records remain immutable until expiry.
    const system = new ParticleSystem(4);
    system.enabled = true;
    system.burst({ lifetime: [2, 2], velocity: [1, 2, 3] }, 2);
    const snapshot = system.records.slice(),
      revision = system.revision;
    system.update(0.2);
    expect(system.records).toEqual(snapshot);
    expect(system.revision).toBe(revision);
    system.enabled = false;
    system.update(1);
    expect(system.time).toBe(0.2);
    expect(system.count).toBe(2);
  });
  it("densely removes expired rows without losing later particles", () => {
    // The swapped live row retains all spawn fields and is marked for a GPU refresh.
    const system = new ParticleSystem(3);
    system.enabled = true;
    system.burst({ position: [1, 0, 0], lifetime: [0.1, 0.1] }, 1);
    system.burst({ position: [2, 0, 0], lifetime: [2, 2] }, 1);
    system.dirtyStart = Infinity;
    system.dirtyEnd = 0;
    system.update(0.2);
    expect(system.count).toBe(1);
    expect(system.records[0]).toBe(2);
    expect(system.dirtyStart).toBe(0);
    expect(system.dirtyEnd).toBe(1);
  });
  it("copies settings, validates atomically and retains seeded determinism", () => {
    // Invalid replacement settings must not corrupt the emitter or existing particle rows.
    const position: [number, number, number] = [2, 0, 0];
    const a = new ParticleSystem(4),
      b = new ParticleSystem(4);
    a.enabled = b.enabled = true;
    const emitter = a.createEmitter({ position, seed: 10 });
    const other = b.createEmitter({ position, seed: 10 });
    position[0] = 99;
    emitter.burst(2);
    other.burst(2);
    expect(a.records).toEqual(b.records);
    expect(a.records[0]).toBe(2);
    expect(() => {
      /* Reject an invalid duration before replacing copied settings. */ emitter.configure(
        { lifetime: [2, 1] },
      );
    }).toThrow();
    expect(() => {
      /* Reject nonfinite origins before updating any coordinate. */ emitter.setPosition(
        0,
        NaN,
        0,
      );
    }).toThrow();
    expect(() => {
      // Represent malformed external settings while deliberately bypassing tuple typing.
      emitter.configure({
        position: new Array<number>(3) as [number, number, number],
      });
    }).toThrow("vector");
    emitter.burst(1);
    expect(a.records[2 * PARTICLE_WORDS]).toBe(2);
    expect(() => {
      /* Counts must be integral even when the pool is already full. */ emitter.burst(
        1.5,
      );
    }).toThrow();
  });
  it("accumulates fractional emission and retires controllers separately from particles", () => {
    // Stopping an emitter does not make already spawned particles disappear.
    const system = new ParticleSystem(10, 1);
    system.enabled = true;
    const emitter = system.createEmitter({ rate: 2, lifetime: [2, 2] });
    system.update(0.2);
    system.update(0.2);
    expect(system.count).toBe(0);
    system.update(0.2);
    expect(system.count).toBe(1);
    emitter.dispose();
    emitter.dispose();
    system.createEmitter();
    system.update(0.1);
    expect(system.count).toBe(1);
    system.dispose();
    system.dispose();
    expect(() => {
      /* Retired controllers reject future burst commands. */ emitter.burst(1);
    }).toThrow("disposed");
  });
  it("prepares GPU owners only at enable/recovery boundaries and supports one-shot presets", () => {
    // One-shot effects consume no persistent emitter slots; disabled scenes prepare no GPU objects.
    const system = new ParticleSystem(4096, 1);
    let preparations = 0;
    const detach = system.attach(() => {
      /* Count explicit setup boundaries. */ preparations++;
    });
    expect(preparations).toBe(0);
    system.enabled = true;
    system.enabled = true;
    expect(preparations).toBe(1);
    for (const effect of [
      "sparks",
      "smoke",
      "explosion",
      "confetti",
      "shockwave",
    ] as const)
      expect(system.playEffect(effect, [0, 0, 0])).toBeGreaterThan(0);
    system.createEmitter();
    detach();
    system.enabled = false;
    system.enabled = true;
    expect(preparations).toBe(1);
    system.clear();
    expect(system.count).toBe(0);
  });
});
