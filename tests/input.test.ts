import { expect, it } from "vitest";
import { KeyboardInput } from "../src/input/KeyboardInput";
/** Returns event. */
function key(target: EventTarget, type: string, code: string): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "code", { value: code });
  target.dispatchEvent(event);
  return event;
}
it("tracks held keys and consumes edges once across repeated events", () => {
  // Verifies tracks held keys and consumes edges once across repeated events.

  const target = new EventTarget(),
    input = new KeyboardInput(target as HTMLElement, ["KeyW"]);
  expect(key(target, "keydown", "KeyW").defaultPrevented).toBe(true);
  expect(input.isDown("KeyW")).toBe(true);
  expect(input.consumePressed("KeyW")).toBe(true);
  key(target, "keydown", "KeyW");
  expect(input.consumePressed("KeyW")).toBe(false);
  key(target, "keyup", "KeyW");
  expect(input.isDown("KeyW")).toBe(false);
  key(target, "keydown", "KeyW");
  expect(input.consumePressed("KeyW")).toBe(true);
  input.dispose();
  key(target, "keydown", "KeyW");
  expect(input.isDown("KeyW")).toBe(false);
});
it("ignores unbound shortcuts and clears keys/edges on focus loss", () => {
  // Verifies ignores unbound shortcuts and clears keys/edges on focus loss.

  const target = new EventTarget(),
    input = new KeyboardInput(target as HTMLElement, ["ArrowUp"]);
  expect(key(target, "keydown", "KeyP").defaultPrevented).toBe(false);
  key(target, "keydown", "ArrowUp");
  target.dispatchEvent(new Event("blur"));
  expect(input.isDown("ArrowUp")).toBe(false);
  expect(input.consumePressed("ArrowUp")).toBe(false);
  input.dispose();
});
it("clears held keys when the browser loses focus or the document becomes hidden", () => {
  // Verifies clears held keys when the browser loses focus or the document becomes hidden.

  const target = new EventTarget(),
    view = new EventTarget(),
    document = new EventTarget();
  Object.assign(document, { defaultView: view, visibilityState: "hidden" });
  Object.assign(target, { ownerDocument: document });
  const input = new KeyboardInput(target as HTMLElement, ["KeyW"]);
  key(target, "keydown", "KeyW");
  view.dispatchEvent(new Event("blur"));
  expect(input.isDown("KeyW")).toBe(false);
  key(target, "keydown", "KeyW");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(input.consumePressed("KeyW")).toBe(false);
  input.dispose();
});
it("leaves browser modifier shortcuts available even for a bound letter", () => {
  // Verifies leaves browser modifier shortcuts available even for a bound letter.

  const target = new EventTarget(),
    input = new KeyboardInput(target as HTMLElement, ["KeyR"]);
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperties(event, {
    code: { value: "KeyR" },
    ctrlKey: { value: true },
  });
  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(input.isDown("KeyR")).toBe(false);
  input.dispose();
});
