export type GamepadProvider = () => readonly (Gamepad | null)[];
/** Standard-mapping sticks/buttons. Poll once per simulation tick; edges persist until consumed. */
export class GamepadInput {
  readonly axes = new Float32Array(4);
  readonly values = new Float32Array(32);
  private readonly down = new Uint8Array(32);
  private readonly pressed = new Uint8Array(32);
  private identity = "";
  private index = -1;
  private zone = 0.15;
  enabled = true;
  connected = false;
  constructor(
    private readonly target?: HTMLElement,
    private readonly provider: GamepadProvider = () => navigator.getGamepads(),
  ) {}
  get deadzone(): number {
    return this.zone;
  }
  set deadzone(value: number) {
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid gamepad deadzone");
    this.zone = value;
  }
  update(): void {
    if (
      !this.enabled ||
      (this.target &&
        (this.target.ownerDocument.visibilityState === "hidden" ||
          this.target.ownerDocument.activeElement !== this.target))
    ) {
      this.clear();
      return;
    }
    const pads = this.provider();
    let pad: Gamepad | undefined;
    for (const candidate of pads)
      if (candidate?.connected && candidate.mapping === "standard") {
        pad = candidate;
        break;
      }
    if (!pad) {
      this.clear();
      return;
    }
    if (pad.id !== this.identity || pad.index !== this.index) this.clear();
    this.identity = pad.id;
    this.index = pad.index;
    this.connected = true;
    for (let pair = 0; pair < 4; pair += 2) {
      const rawX = pad.axes[pair] ?? 0,
        rawY = pad.axes[pair + 1] ?? 0;
      const x = Number.isFinite(rawX) ? rawX : 0,
        y = Number.isFinite(rawY) ? rawY : 0;
      const length = Math.hypot(x, y),
        scale =
          length <= this.zone
            ? 0
            : (Math.min(1, length) - this.zone) / ((1 - this.zone) * length);
      this.axes[pair] = x * scale;
      this.axes[pair + 1] = y * scale;
    }
    for (let i = 0; i < this.values.length; i++) {
      const button = pad.buttons[i],
        value = button?.value ?? 0;
      this.values[i] = Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : 0;
      const held = Number(button?.pressed ?? false);
      if (held && !this.down[i]) this.pressed[i] = 1;
      this.down[i] = held;
    }
  }
  isDown(button: number): boolean {
    return this.down[button] === 1;
  }
  consumePressed(button: number): boolean {
    const value = this.pressed[button] === 1;
    if (value) this.pressed[button] = 0;
    return value;
  }
  clear(): void {
    this.axes.fill(0);
    this.values.fill(0);
    this.down.fill(0);
    this.pressed.fill(0);
    this.identity = "";
    this.index = -1;
    this.connected = false;
  }
  dispose(): void {
    this.enabled = false;
    this.clear();
  }
}
