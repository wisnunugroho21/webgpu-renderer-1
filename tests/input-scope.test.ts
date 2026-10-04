import { expect, it, vi } from "vitest";
import { InputScope } from "../src/input/InputScope";
it("retains unrelated listeners and removes target/document/window subscriptions on idempotent teardown", () => {
  const target = new EventTarget(),
    document = new EventTarget(),
    view = new EventTarget();
  Object.assign(document, { defaultView: view, visibilityState: "visible" });
  Object.assign(target, { ownerDocument: document });
  const clear = vi.fn(),
    own = vi.fn(),
    external = vi.fn();
  target.addEventListener("pointerdown", external);
  const scope = new InputScope(target as HTMLElement, clear);
  scope.listen("pointerdown", own);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(clear).not.toHaveBeenCalled();
  Object.assign(document, { visibilityState: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  view.dispatchEvent(new Event("blur"));
  expect(clear).toHaveBeenCalledTimes(2);
  target.dispatchEvent(new Event("pointerdown"));
  expect(own).toHaveBeenCalledTimes(1);
  scope.dispose();
  scope.dispose();
  target.dispatchEvent(new Event("pointerdown"));
  target.dispatchEvent(new Event("blur"));
  document.dispatchEvent(new Event("visibilitychange"));
  view.dispatchEvent(new Event("blur"));
  expect(clear).toHaveBeenCalledTimes(2);
  expect(own).toHaveBeenCalledTimes(1);
  expect(external).toHaveBeenCalledTimes(2);
});
