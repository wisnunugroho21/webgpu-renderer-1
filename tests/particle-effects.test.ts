import { describe, it, expect } from "vitest";
import { ParticleSystem } from "../src/particles/ParticleSystem";
import {
  PARTICLE_WORDS,
  PARTICLE_SPRITE,
  PARTICLE_EFFECTS,
} from "../src/particles/ParticleLayout";

describe("shared particle authoring data", () => {
  // Validate authoring state independently of device resources and rendering.
  it("copies atlases and rejects frame ranges before replacing active provenance", () => {
    // Caller edits and incompatible replacements must not corrupt live flipbooks.
    const s = new ParticleSystem(4);
    s.enabled = true;
    const pixels = new Uint8Array(16).fill(255);
    s.setAtlas({ width: 2, height: 2, columns: 2, rows: 2, pixels });
    pixels[0] = 0;
    expect(s.atlas!.pixels[0]).toBe(255);
    const e = s.createEmitter({
      sprite: { firstFrame: 1, frameCount: 3, fps: 12, loop: true },
    });
    e.burst(1);
    expect(
      Array.from(s.records.slice(PARTICLE_SPRITE, PARTICLE_SPRITE + 4)),
    ).toEqual([1, 3, 12, 1]);
    expect(() => {
      /* Incompatible cold replacement must leave old CPU provenance intact. */ s.setAtlas(
        null,
      );
    }).toThrow();
    expect(s.atlas!.columns).toBe(2);
    expect(() => {
      /* Invalid frame ranges cannot consume pool capacity. */ s.burst(
        { sprite: { firstFrame: 4 } },
        1,
      );
    }).toThrow();
    expect(s.count).toBe(1);
  });
  it("deduplicates curves, copies keys and validates unknown references atomically", () => {
    // Stable profiles are shared across emitters and do not consume a slot when identical.
    const s = new ParticleSystem(4);
    s.enabled = true;
    const keys = [
      { time: 0, size: 0 },
      { time: 0.5, size: 2 },
      { time: 1, size: 0 },
    ];
    const id = s.createCurve(keys);
    expect(s.createCurve(keys)).toBe(id);
    keys[1]!.size = 9;
    const e = s.createEmitter({ curve: id, softDistance: 0.4 });
    e.burst(1);
    expect(s.records[PARTICLE_EFFECTS]).toBe(id);
    expect(s.records[PARTICLE_EFFECTS + 1]).toBeCloseTo(0.4);
    expect(() => {
      /* Reject unknown shared IDs before replacing emitter settings. */ e.configure(
        { curve: 63 },
      );
    }).toThrow();
    expect(() => {
      /* GPU key intervals must be strictly ordered after Float32 conversion. */ s.createCurve(
        [{ time: 0 }, { time: 0 }, { time: 1 }],
      );
    }).toThrow();
    expect(() => {
      /* Endpoint requirements prevent undefined GPU interpolation. */ s.createCurve(
        [{ time: 0.1 }, { time: 1 }],
      );
    }).toThrow();
    e.burst(1);
    expect(s.records[PARTICLE_WORDS + PARTICLE_EFFECTS]).toBe(id);
  });
  it("emits deterministic volume spheres and directed cones with bounded launch speed", () => {
    // An arbitrarily oriented basis must preserve cone direction and uniform-volume bounds.
    for (const shape of ["cone", "sphere"] as const) {
      const a = new ParticleSystem(256),
        b = new ParticleSystem(256);
      a.enabled = b.enabled = true;
      const options = {
        velocity: [0, 0, 0] as const,
        velocitySpread: [0, 0, 0] as const,
        emission: {
          shape,
          direction: [1, 0, 0] as const,
          angle: 0.2,
          radius: 2,
          speed: [3, 3] as const,
        },
        seed: 9,
      };
      a.burst(options, 256);
      b.burst(options, 256);
      expect(a.records).toEqual(b.records);
      for (let i = 0; i < 256; i++) {
        const o = i * PARTICLE_WORDS,
          r = a.records;
        expect(Math.hypot(r[o]!, r[o + 1]!, r[o + 2]!)).toBeLessThanOrEqual(
          2.000001,
        );
        expect(Math.hypot(r[o + 4]!, r[o + 5]!, r[o + 6]!)).toBeCloseTo(3, 5);
        if (shape === "cone")
          expect(r[o + 4]! / 3).toBeGreaterThanOrEqual(
            Math.cos(0.2) - 0.000001,
          );
      }
    }
  });
  it("rejects degenerate direction, invalid atlas bytes and malformed emission ranges", () => {
    // Validation occurs before any pool or profile publication.
    const s = new ParticleSystem();
    s.enabled = true;
    expect(() => {
      /* Zero direction cannot define a cone basis. */ s.createEmitter({
        emission: { shape: "cone", direction: [0, 0, 0] },
      });
    }).toThrow();
    expect(() => {
      /* Reversed speed bounds cannot define sampling. */ s.burst(
        { emission: { shape: "sphere", speed: [2, 1] } },
        1,
      );
    }).toThrow();
    expect(() => {
      /* Atlas rows must include every RGBA texel. */ s.setAtlas({
        width: 2,
        height: 2,
        columns: 1,
        rows: 1,
        pixels: new Uint8Array(4),
      });
    }).toThrow();
    expect(s.count).toBe(0);
  });
});
