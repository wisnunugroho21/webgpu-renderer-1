import { expect, it, vi } from "vitest";
import { SimulationLoop } from "../src/app/SimulationLoop";
it("runs fixed steps before the variable update and exposes interpolation", () => {
  const loop = new SimulationLoop();
  loop.configure({ stepSeconds: 0.1, maxSteps: 4 });
  const events: string[] = [];
  loop.onFixedUpdate((dt, time) =>
    events.push(`fixed:${dt}:${time.toFixed(1)}`),
  );
  loop.onUpdate((_dt, alpha) => events.push(`frame:${alpha.toFixed(1)}`));
  loop.advance(0.15);
  loop.advance(0.05);
  expect(events).toEqual([
    "fixed:0.1:0.1",
    "frame:0.5",
    "fixed:0.1:0.2",
    "frame:0.0",
  ]);
});
it("bounds catch-up, reports discarded time, and resets pause debt", () => {
  const loop = new SimulationLoop(),
    fixed = vi.fn();
  loop.onFixedUpdate(fixed);
  expect(loop.advance(10)).toBe(0.25);
  expect(fixed).toHaveBeenCalledTimes(8);
  expect(loop.droppedSeconds).toBeGreaterThan(9.8);
  expect(loop.alpha).toBeLessThan(1);
  loop.resetAccumulator();
  loop.advance(0);
  expect(loop.alpha).toBe(0);
  expect(fixed).toHaveBeenCalledTimes(8);
});
it("defers additions, skips removed callbacks during dispatch, and clears on disposal", () => {
  const loop = new SimulationLoop(),
    events: string[] = [];
  let off = () => {};
  loop.onUpdate(() => {
    events.push("a");
    off();
    loop.onUpdate(() => events.push("c"));
  });
  off = loop.onUpdate(() => events.push("b"));
  loop.advance(0);
  expect(events).toEqual(["a"]);
  loop.advance(0);
  expect(events).toEqual(["a", "a", "c"]);
  loop.clear();
  loop.advance(0);
  expect(events).toEqual(["a", "a", "c"]);
});
it("rejects invalid timing and propagates gameplay errors", () => {
  const loop = new SimulationLoop();
  for (const stepSeconds of [0, -1, NaN, Infinity])
    expect(() => loop.configure({ stepSeconds })).toThrow();
  expect(() => loop.configure({ maxSteps: 0 })).toThrow();
  expect(() => loop.advance(-1)).toThrow();
  loop.onUpdate(() => {
    throw new Error("game failed");
  });
  expect(() => loop.advance(0)).toThrow("game failed");
});
it("does not advance very small fixed steps when no time elapsed", () => {
  const loop = new SimulationLoop(),
    fixed = vi.fn();
  loop.configure({ stepSeconds: 1e-15 });
  loop.onFixedUpdate(fixed);
  loop.advance(0);
  expect(fixed).not.toHaveBeenCalled();
  expect(loop.simulationSeconds).toBe(0);
});
