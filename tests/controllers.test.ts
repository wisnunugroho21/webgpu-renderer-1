import { expect, it } from "vitest";
import { PointerInput } from "../src/input/PointerInput";
import { TouchJoystick } from "../src/input/TouchJoystick";
import { GamepadInput } from "../src/input/GamepadInput";
import { Camera } from "../src/rendering/Camera";
import { OrbitCameraController } from "../src/camera/OrbitCameraController";
import { ThirdPersonCameraController } from "../src/camera/ThirdPersonCameraController";
/** Builds a record containing target, doc, view, captures. */
function surface() {
  const target = new EventTarget(),
    doc = new EventTarget(),
    view = new EventTarget(),
    captures = new Set<number>();
  Object.assign(doc, {
    defaultView: view,
    visibilityState: "visible",
    activeElement: target,
  });
  Object.assign(target, {
    ownerDocument: doc,
    style: { touchAction: "pan-y" },
    clientHeight: 480,
    /** Intentionally performs no work at this optional callback boundary. */
    focus() {},
    /** Applies captures.add to set pointer capture. */
    setPointerCapture(id: number) {
      captures.add(id);
    },
    /** Delegates this operation to captures.has. */
    hasPointerCapture(id: number) {
      return captures.has(id);
    },
    /** Applies captures.delete to release pointer capture. */
    releasePointerCapture(id: number) {
      captures.delete(id);
    },
  });
  return { target: target as HTMLElement, doc, view, captures };
}
/** Returns event. */
function send(target: EventTarget, type: string, fields: object) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
  return event;
}
it("consumes captured pointer deltas and normalized wheel once, clears on focus loss and disposal", () => {
  // Verifies consumes captured pointer deltas and normalized wheel once, clears on focus loss and disposal.

  const { target, captures, view } = surface(),
    pointer = new PointerInput(target),
    out = new Float32Array(3);
  send(target, "pointerdown", {
    pointerId: 1,
    button: 0,
    clientX: 10,
    clientY: 20,
  });
  send(target, "pointermove", { pointerId: 2, clientX: 100, clientY: 100 });
  send(target, "pointermove", { pointerId: 1, clientX: 20, clientY: 15 });
  send(target, "wheel", { deltaY: 2, deltaMode: 1 });
  pointer.consume(out);
  expect(Array.from(out)).toEqual([10, -5, 32]);
  pointer.consume(out);
  expect(Array.from(out)).toEqual([0, 0, 0]);
  expect(captures.size).toBe(1);
  view.dispatchEvent(new Event("blur"));
  expect(captures.size).toBe(0);
  expect(pointer.dragging).toBe(false);
  expect(() =>
    /** Delegates this operation to pointer.consume. */ pointer.consume(
      new Float32Array(2),
    ),
  ).toThrow();
  pointer.dispose();
  expect(target.style.touchAction).toBe("pan-y");
  send(target, "pointerdown", { pointerId: 1, button: 0 });
  expect(pointer.dragging).toBe(false);
});
it("preserves completed drags, rejects secondary buttons, clears hidden/cancelled input", () => {
  // Verifies preserves completed drags, rejects secondary buttons, clears hidden/cancelled input.

  const { target, doc } = surface(),
    pointer = new PointerInput(target),
    out = new Float32Array(3);
  send(target, "pointerdown", { pointerId: 1, button: 2 });
  expect(pointer.dragging).toBe(false);
  send(target, "pointerdown", {
    pointerId: 1,
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  send(target, "pointermove", { pointerId: 1, clientX: 4, clientY: 6 });
  send(target, "pointerup", { pointerId: 1 });
  pointer.consume(out);
  expect(Array.from(out)).toEqual([4, 6, 0]);
  send(target, "wheel", { deltaY: 3, deltaMode: 2 });
  Object.assign(doc, { visibilityState: "hidden" });
  doc.dispatchEvent(new Event("visibilitychange"));
  pointer.consume(out);
  expect(out[2]).toBe(0);
  pointer.dispose();
});
it("normalizes one touch joystick radially and releases capture on cancellation", () => {
  // Verifies normalizes one touch joystick radially and releases capture on cancellation.

  const { target, captures } = surface(),
    stick = new TouchJoystick(target, 50);
  send(target, "pointerdown", {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
  });
  expect(captures.size).toBe(0);
  send(target, "pointerdown", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 0,
    clientY: 0,
  });
  send(target, "pointerdown", {
    pointerId: 3,
    pointerType: "touch",
    clientX: 0,
    clientY: 0,
  });
  send(target, "pointermove", { pointerId: 3, clientX: 50, clientY: 0 });
  expect(stick.axes[0]).toBe(0);
  send(target, "pointermove", { pointerId: 2, clientX: 100, clientY: 100 });
  expect(Math.hypot(...stick.axes)).toBeCloseTo(1);
  send(target, "pointercancel", { pointerId: 2 });
  expect(Array.from(stick.axes)).toEqual([0, 0]);
  expect(captures.size).toBe(0);
  stick.dispose();
  expect(target.style.touchAction).toBe("pan-y");
  expect(
    () =>
      /** Creates TouchJoystick storage for this operation. */ new TouchJoystick(
        target,
        0,
      ),
  ).toThrow();
});
it("polls standard gamepads with radial deadzones and persistent edges, clears disconnect/focus", () => {
  // Verifies polls standard gamepads with radial deadzones and persistent edges, clears disconnect/focus.

  const { target, doc } = surface();
  const pad = {
    index: 0,
    id: "test",
    connected: true,
    mapping: "standard",
    axes: [0.1, 0, 1, 1],
    buttons: [{ pressed: true, value: 1 }],
  } as unknown as Gamepad;
  let pads: (Gamepad | null)[] = [pad];
  const input = new GamepadInput(
    target,
    () =>
      /** Verifies polls standard gamepads with radial deadzones and persistent edges, clears disconnect/focus. */ pads,
  );
  input.update();
  expect(input.axes[0]).toBe(0);
  expect(Math.hypot(input.axes[2]!, input.axes[3]!)).toBeCloseTo(1);
  input.update();
  expect(input.consumePressed(0)).toBe(true);
  expect(input.consumePressed(0)).toBe(false);
  input.update();
  expect(input.consumePressed(0)).toBe(false);
  expect(input.isDown(0)).toBe(true);
  Object.assign(doc, { activeElement: null });
  input.update();
  expect(input.isDown(0)).toBe(false);
  Object.assign(doc, { activeElement: target });
  input.update();
  expect(input.consumePressed(0)).toBe(true);
  pads = [];
  input.update();
  expect(input.connected).toBe(false);
  expect(
    input.axes.every((x) => /** Evaluates the x === 0 condition. */ x === 0),
  ).toBe(true);
  expect(
    () => /** Computes the input.deadzone = 1 result. */ (input.deadzone = 1),
  ).toThrow();
  input.dispose();
  pads = [pad];
  input.update();
  expect(input.connected).toBe(false);
});
it("keeps orbit radius and projection, clamps zoom/poles, resynchronizes teleports", () => {
  // Verifies keeps orbit radius and projection, clamps zoom/poles, resynchronizes teleports.

  const camera = new Camera();
  camera.setPosition(0, 0, 5);
  camera.setTarget(0, 0, 0);
  camera.setOrthographic();
  const orbit = new OrbitCameraController(camera, {
    minDistance: 2,
    maxDistance: 8,
  });
  orbit.update(100, 0);
  expect(Math.hypot(...camera.position)).toBeCloseTo(5);
  expect(camera.position[0]).not.toBe(0);
  orbit.update(0, 10000, 100000);
  expect(Math.hypot(...camera.position)).toBeCloseTo(8);
  camera.update(1);
  expect(Array.from(camera.viewProjection).every(Number.isFinite)).toBe(true);
  orbit.update(0, 0, -100000);
  expect(Math.hypot(...camera.position)).toBeCloseTo(2);
  expect(camera.projectionType).toBe("orthographic");
  camera.setPosition(0, 0, 6);
  orbit.syncFromCamera();
  orbit.update();
  expect(camera.position[2]).toBeCloseTo(6);
  expect(() =>
    /** Delegates this operation to orbit.update. */ orbit.update(NaN),
  ).toThrow();
  expect(
    () =>
      /** Creates OrbitCameraController storage for this operation. */ new OrbitCameraController(
        camera,
        { minDistance: 0 },
      ),
  ).toThrow();
});
it("follows stationary targets identically across update rates and supports heading/snap", () => {
  // Verifies follows stationary targets identically across update rates and supports heading/snap.

  const a = new Camera(),
    b = new Camera(),
    ca = new ThirdPersonCameraController(a),
    cb = new ThirdPersonCameraController(b),
    target = new Float32Array([10, 2, 3]);
  for (let i = 0; i < 30; i++) ca.follow(1 / 30, target);
  for (let i = 0; i < 120; i++) cb.follow(1 / 120, target);
  for (let i = 0; i < 3; i++)
    expect(a.position[i]).toBeCloseTo(b.position[i]!, 4);
  ca.follow(0, target, Math.PI, 0, 0, 0, true);
  expect(Array.from(a.target)).toEqual([10, 3, 3]);
  const offset = a.position[2]! - 3;
  ca.follow(0, target, 0, 0, 0, 0, true);
  expect(a.position[2]! - 3).toBeCloseTo(-offset);
  expect(() =>
    /** Delegates this operation to ca.follow. */ ca.follow(-1, target),
  ).toThrow();
  expect(() =>
    /** Delegates this operation to ca.follow. */ ca.follow(1, [NaN, 0, 0]),
  ).toThrow();
});
