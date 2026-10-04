/** Virtual stick anchored where a touch starts; supports concurrent camera drag on another element. */
export class TouchJoystick {
  readonly axes = new Float32Array(2);
  private pointer = -1;
  private x = 0;
  private y = 0;
  private readonly previousTouchAction: string;
  constructor(
    private readonly target: HTMLElement,
    private readonly radius = 48,
  ) {
    if (!Number.isFinite(radius) || radius <= 0)
      throw new Error("Invalid joystick radius");
    this.previousTouchAction = target.style.touchAction;
    target.style.touchAction = "none";
    target.addEventListener("pointerdown", this.down);
    target.addEventListener("pointermove", this.move);
    target.addEventListener("pointerup", this.up);
    target.addEventListener("pointercancel", this.up);
    target.addEventListener("lostpointercapture", this.up);
    target.ownerDocument.defaultView?.addEventListener("blur", this.clear);
    target.ownerDocument.addEventListener("visibilitychange", this.visibility);
  }
  private readonly down = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || this.pointer !== -1) return;
    this.target.setPointerCapture(event.pointerId);
    this.pointer = event.pointerId;
    this.x = event.clientX;
    this.y = event.clientY;
    this.axes.fill(0);
    event.preventDefault();
  };
  private readonly move = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return;
    const x = (event.clientX - this.x) / this.radius,
      y = (event.clientY - this.y) / this.radius;
    const length = Math.max(1, Math.hypot(x, y));
    this.axes[0] = x / length;
    this.axes[1] = y / length;
    event.preventDefault();
  };
  private readonly up = (event: PointerEvent): void => {
    if (event.pointerId === this.pointer) this.clear();
  };
  private readonly visibility = (): void => {
    if (this.target.ownerDocument.visibilityState === "hidden") this.clear();
  };
  readonly clear = (): void => {
    const id = this.pointer;
    this.pointer = -1;
    this.axes.fill(0);
    if (id !== -1 && this.target.hasPointerCapture(id))
      this.target.releasePointerCapture(id);
  };
  dispose(): void {
    this.clear();
    this.target.removeEventListener("pointerdown", this.down);
    this.target.removeEventListener("pointermove", this.move);
    this.target.removeEventListener("pointerup", this.up);
    this.target.removeEventListener("pointercancel", this.up);
    this.target.removeEventListener("lostpointercapture", this.up);
    this.target.ownerDocument.defaultView?.removeEventListener(
      "blur",
      this.clear,
    );
    this.target.ownerDocument.removeEventListener(
      "visibilitychange",
      this.visibility,
    );
    this.target.style.touchAction = this.previousTouchAction;
  }
}
