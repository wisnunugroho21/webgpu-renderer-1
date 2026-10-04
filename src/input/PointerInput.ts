import { InputScope } from "./InputScope";
/** Single captured mouse/pen/touch drag. Consume deltas once per update, not once per render pass. */
export class PointerInput {
  private readonly scope: InputScope;
  private pointer = -1;
  private x = 0;
  private y = 0;
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  private readonly previousTouchAction: string;
  constructor(private readonly target: HTMLElement) {
    this.previousTouchAction = target.style.touchAction;
    target.style.touchAction = "none";
    this.scope = new InputScope(target, this.clear);
    this.scope.listen("pointerdown", this.down);
    this.scope.listen("pointermove", this.move);
    this.scope.listen("pointerup", this.up);
    this.scope.listen("pointercancel", this.up);
    this.scope.listen("lostpointercapture", this.up);
    this.scope.listen("wheel", this.scroll, { passive: false });
  }
  get dragging(): boolean {
    return this.pointer !== -1;
  }
  private readonly down = (event: PointerEvent): void => {
    if (this.dragging || event.button !== 0) return;
    this.target.focus();
    this.target.setPointerCapture(event.pointerId);
    this.pointer = event.pointerId;
    this.x = event.clientX;
    this.y = event.clientY;
    event.preventDefault();
  };
  private readonly move = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return;
    this.dx += event.clientX - this.x;
    this.dy += event.clientY - this.y;
    this.x = event.clientX;
    this.y = event.clientY;
    event.preventDefault();
  };
  private readonly up = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return;
    if (event.type === "pointercancel") this.clear();
    else this.release();
  };
  private release(): void {
    const id = this.pointer;
    this.pointer = -1;
    if (id !== -1 && this.target.hasPointerCapture(id))
      this.target.releasePointerCapture(id);
  }
  private readonly scroll = (event: WheelEvent): void => {
    // Normalize line/page units to CSS pixels. Bound a single device event before exponential dolly.
    const units =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? this.target.clientHeight
          : 1;
    this.wheel += Math.max(-1000, Math.min(1000, event.deltaY * units));
    event.preventDefault();
  };

  /** out[0..2] = horizontal drag, vertical drag, wheel in CSS pixels. Caller owns storage. */
  consume(out: Float32Array): void {
    if (out.length < 3) throw new Error("Pointer output needs three floats");
    out[0] = this.dx;
    out[1] = this.dy;
    out[2] = this.wheel;
    this.dx = this.dy = this.wheel = 0;
  }
  readonly clear = (): void => {
    this.release();
    this.dx = this.dy = this.wheel = 0;
  };
  dispose(): void {
    this.clear();
    this.scope.dispose();
    this.target.style.touchAction = this.previousTouchAction;
  }
}
