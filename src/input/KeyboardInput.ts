import { InputScope } from "./InputScope";
/** Focus-scoped keyboard state. Blur clears held keys; edges survive until a simulation tick consumes them. */
export class KeyboardInput {
  private readonly scope: InputScope;
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly allowed: Set<string>;
  constructor(target: HTMLElement, codes: readonly string[]) {
    this.allowed = new Set(codes);
    this.scope = new InputScope(target, this.clear);
    this.scope.listen("keydown", this.keydown);
    this.scope.listen("keyup", this.keyup);
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
    this.scope.dispose();
    this.clear();
  }
}
