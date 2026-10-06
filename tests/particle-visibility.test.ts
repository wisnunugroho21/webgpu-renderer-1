import { describe, it, expect } from "vitest";
import { ParticleVisibility } from "../src/rendering/particles/ParticleVisibility";
import { ParticleSystem } from "../src/particles/ParticleSystem";
import {
  particleAtlasMipLevels,
  copyParticleAtlas,
} from "../src/particles/ParticleAtlas";
const matrix = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);
describe("conservative particle visibility", () => {
  // Clip-space identity makes every boundary independently inspectable.
  it("retains intersecting bounds on all six planes", () => {
    // Conservative intersection retains all clip-plane edges.
    const v = new ParticleVisibility();
    v.prepare(matrix);
    expect(v.sphere(1.2, 0, 0.5, 0.3)).toBe(true);
    expect(v.sphere(1.4, 0, 0.5, 0.3)).toBe(false);
    expect(v.sphere(0, 0, -0.2, 0.3)).toBe(true);
    expect(v.sphere(0, 0, 1.4, 0.3)).toBe(false);
    expect(v.sphere(0, -1.3, 0.5, 0.3)).toBe(true);
  });
  it("follows analytic gravity and drag without changing records", () => {
    // A moving emitter crosses the frustum while the immutable spawn record remains resident.
    const v = new ParticleVisibility();
    v.prepare(matrix);
    const s = new ParticleSystem(1);
    s.enabled = true;
    s.burst(
      {
        position: [3, 0, 0.5],
        velocity: [-3, 0, 0],
        velocitySpread: [0, 0, 0],
        gravity: [0, 0, 0],
        drag: 0,
        startSize: 0.1,
        endSize: 0.1,
        lifetime: [10, 10],
      },
      1,
    );
    const before = s.records.slice();
    expect(v.billboard(s, 0)).toBe(false);
    s.update(1);
    expect(v.billboard(s, 0)).toBe(true);
    expect(s.records).toEqual(before);
    s.records[11] = 1;
    expect(v.billboard(s, 0)).toBe(false);
  });
  it("bounds peak curve sizes and ribbon endpoint crossings", () => {
    // Bounds include rotated corners, future curve peaks and the maximum ribbon miter.
    const v = new ParticleVisibility();
    v.prepare(matrix);
    const s = new ParticleSystem(1);
    s.enabled = true;
    const curve = s.createCurve([
      { time: 0, size: 1 },
      { time: 0.5, size: 4 },
      { time: 1, size: 1 },
    ]);
    s.burst({ position: [2, 0, 0.5], startSize: 0.5, endSize: 0.5, curve }, 1);
    expect(v.billboard(s, 0)).toBe(true);
    s.trails.records.set([-2, 0, 0.5, 0, 2, 0, 0.5]);
    s.trails.records[20] = 0.1;
    expect(v.ribbon(s, 0)).toBe(true);
    s.trails.records[0] = s.trails.records[4] = 5;
    expect(v.ribbon(s, 0)).toBe(false);
  });
  it("stops mips before tile boundaries become fractional", () => {
    // Each reduction must stay wholly within an individual evenly tiled source cell.
    const atlas = (
      width: number,
      height: number,
      columns: number,
      rows: number,
    ) => {
      // Construct validated CPU-only atlas definitions for varied tile sizes.
      return copyParticleAtlas({
        width,
        height,
        columns,
        rows,
        pixels: new Uint8Array(width * height * 4),
        mipmaps: true,
      });
    };
    expect(particleAtlasMipLevels(atlas(16, 8, 2, 1))).toBe(4);
    expect(particleAtlasMipLevels(atlas(12, 6, 2, 1))).toBe(2);
    expect(particleAtlasMipLevels(atlas(10, 5, 2, 1))).toBe(1);
    expect(particleAtlasMipLevels(null)).toBe(1);
  });
});
