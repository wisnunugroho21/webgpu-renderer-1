/** Focus-scoped keyboard state. Blur clears held keys; edges survive until a simulation tick consumes them. */
export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly allowed: Set<string>;
  constructor(
    private readonly target: HTMLElement,
    codes: readonly string[],
  ) {
    this.allowed = new Set(codes);
    target.addEventListener("keydown", this.keydown);
    target.addEventListener("keyup", this.keyup);
    target.addEventListener("blur", this.clear);
    target.ownerDocument?.defaultView?.addEventListener("blur", this.clear);
    target.ownerDocument?.addEventListener("visibilitychange", this.visibility);
  }
  private readonly keydown = (event: KeyboardEvent): void => {
    if (
      !this.allowed.has(event.code) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (!this.down.has(event.code)) this.pressed.add(event.code);
    this.down.add(event.code);
  };
  private readonly keyup = (event: KeyboardEvent): void => {
    if (!this.allowed.has(event.code)) return;
    event.preventDefault();
    this.down.delete(event.code);
  };
  private readonly visibility = (): void => {
    if (this.target.ownerDocument.visibilityState === "hidden") this.clear();
  };
  isDown(code: string): boolean {
    return this.down.has(code);
  }
  consumePressed(code: string): boolean {
    return this.pressed.delete(code);
  }
  readonly clear = (): void => {
    this.down.clear();
    this.pressed.clear();
  };
  dispose(): void {
    this.target.removeEventListener("keydown", this.keydown);
    this.target.removeEventListener("keyup", this.keyup);
    this.target.removeEventListener("blur", this.clear);
    this.target.ownerDocument?.defaultView?.removeEventListener(
      "blur",
      this.clear,
    );
    this.target.ownerDocument?.removeEventListener(
      "visibilitychange",
      this.visibility,
    );
    this.clear();
  }
}
