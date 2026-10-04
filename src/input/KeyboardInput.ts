import { InputScope } from "./InputScope";
/** Focus-scoped keyboard state. Blur clears held keys; edges survive until a simulation tick consumes them. */
export class KeyboardInput {
  private readonly scope: InputScope;
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly allowed: Set<string>;
  /** Initializes focus-scoped held keys and consumable key edges. */
  constructor(target: HTMLElement, codes: readonly string[]) {
    this.allowed = new Set(codes);
    this.scope = new InputScope(target, this.clear);
    this.scope.listen("keydown", this.keydown);
    this.scope.listen("keyup", this.keyup);
  }
  /** Records allowed held keys and first-press edges while leaving modifier shortcuts untouched. */
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
  /** Clears an allowed held key without consuming its pending press edge. */
  private readonly keyup = (event: KeyboardEvent): void => {
    if (!this.allowed.has(event.code)) return;
    event.preventDefault();
    this.down.delete(event.code);
  };

  /** Reports whether an allowed key is currently held in this focused input scope. */
  isDown(code: string): boolean {
    return this.down.has(code);
  }
  /** Consumes a key press edge once, allowing fixed ticks to observe short presses. */
  consumePressed(code: string): boolean {
    return this.pressed.delete(code);
  }
  /** Clears held keys and pending press edges on focus loss or teardown. */
  readonly clear = (): void => {
    this.down.clear();
    this.pressed.clear();
  };
  /** Removes scoped listeners and clears all keyboard state. */
  dispose(): void {
    this.scope.dispose();
    this.clear();
  }
}
