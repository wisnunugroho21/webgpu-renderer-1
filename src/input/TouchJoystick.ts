import { InputScope } from "./InputScope";
/** Virtual stick anchored where a touch starts; supports concurrent camera drag on another element. */
export class TouchJoystick {
  private readonly scope: InputScope;
  readonly axes = new Float32Array(2);
  private pointer = -1;
  private x = 0;
  private y = 0;
  private readonly previousTouchAction: string;
  /** Initializes bounded touch-stick axes and pointer capture; invalid input is rejected. */
  constructor(
    private readonly target: HTMLElement,
    private readonly radius = 48,
  ) {
    if (!Number.isFinite(radius) || radius <= 0)
      throw new Error("Invalid joystick radius");
    this.previousTouchAction = target.style.touchAction;
    target.style.touchAction = "none";
    this.scope = new InputScope(target, this.clear, false);
    this.scope.listen("pointerdown", this.down);
    this.scope.listen("pointermove", this.move);
    this.scope.listen("pointerup", this.up);
    this.scope.listen("pointercancel", this.up);
    this.scope.listen("lostpointercapture", this.up);
  }
  /** Captures the active touch pointer and establishes the stick origin. */
  private readonly down = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || this.pointer !== -1) return;
    this.target.setPointerCapture(event.pointerId);
    this.pointer = event.pointerId;
    this.x = event.clientX;
    this.y = event.clientY;
    this.axes.fill(0);
    event.preventDefault();
  };
  /** Converts the captured pointer displacement into bounded normalized stick axes. */
  private readonly move = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return;
    const x = (event.clientX - this.x) / this.radius,
      y = (event.clientY - this.y) / this.radius;
    const length = Math.max(1, Math.hypot(x, y));
    this.axes[0] = x / length;
    this.axes[1] = y / length;
    event.preventDefault();
  };
  /** Releases the active touch and resets the axes. */
  private readonly up = (event: PointerEvent): void => {
    if (event.pointerId === this.pointer) this.clear();
  };

  /** Releases capture and zeros the joystick axes. */
  readonly clear = (): void => {
    const id = this.pointer;
    this.pointer = -1;
    this.axes.fill(0);
    if (id !== -1 && this.target.hasPointerCapture(id))
      this.target.releasePointerCapture(id);
  };
  /** Removes listeners, releases capture and restores the previous touch-action style. */
  dispose(): void {
    this.clear();
    this.scope.dispose();
    this.target.style.touchAction = this.previousTouchAction;
  }
}
