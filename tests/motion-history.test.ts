import { describe, it, expect } from "vitest";
import { MotionHistory } from "../src/rendering/post/MotionHistory";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { Camera } from "../src/rendering/Camera";
describe("temporal pose identities", () => {
  // Tests focus on stale history and reordered extraction, where visual ghosts can otherwise persist.
  it("remaps previous transforms after compact extraction reorder", () => {
    // Entity identity, rather than compact slot, determines previous placement.
    const w = new RenderWorld(2),
      m = new MaterialManager(2),
      h = new MotionHistory(2, 8, 16);
    m.create({});
    w.count = 2;
    w.entityId.set([1, 2]);
    w.entityGeneration.set([1, 1]);
    w.matrices[12] = 10;
    w.matrices[28] = 20;
    h.prepare(w, m);
    expect(h.currentWords[27]).toBe(0);
    h.capture(w, m);
    w.entityId.set([2, 1]);
    w.matrices[12] = 21;
    w.matrices[28] = 11;
    h.prepare(w, m);
    expect(h.previous[12]).toBe(20);
    expect(h.previous[40]).toBe(10);
    expect(h.currentWords[27]).toBe(1);
    w.entityGeneration[0] = 2;
    h.prepare(w, m);
    expect(h.currentWords[27]).toBe(0);
    expect(h.previous[12]).toBe(21);
  });
  it("invalidates new topology and retired identities", () => {
    // Mesh replacement and explicit camera cuts must not borrow incompatible previous vertices.
    const w = new RenderWorld(1),
      m = new MaterialManager(1),
      h = new MotionHistory(1, 4, 4);
    m.create({});
    w.count = 1;
    w.entityId[0] = 4;
    h.prepare(w, m);
    h.capture(w, m);
    w.meshId[0] = 2;
    h.prepare(w, m);
    expect(h.currentWords[27]).toBe(0);
    h.capture(w, m);
    h.prepare(w, m);
    expect(h.currentWords[27]).toBe(1);
    h.reset();
    h.prepare(w, m);
    expect(h.currentWords[27]).toBe(0);
  });
  it("jitter preserves authored projection and clears without drift", () => {
    // Subpixel offsets modify clip coordinates once, leaving projection options intact.
    const c = new Camera();
    c.update(1);
    const baseline = c.viewProjection.slice();
    c.setJitter(0.001, -0.002);
    c.update(1);
    expect(c.viewProjection).not.toEqual(baseline);
    c.setJitter(0, 0);
    c.update(1);
    expect(c.viewProjection).toEqual(baseline);
    expect(() => {
      /* Reject nonfinite clip offsets before camera state changes. */ return c.setJitter(
        NaN,
        0,
      );
    }).toThrow("Invalid camera jitter");
  });
});
