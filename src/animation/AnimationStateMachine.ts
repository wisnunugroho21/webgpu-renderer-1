import { Animator } from "./Animator";
export interface AnimationState {
  readonly clip: number;
  readonly loop?: boolean;
  readonly speed?: number;
  readonly fadeSeconds?: number;
}
/** Gameplay chooses named states; repeated requests never restart playback or a fade. */
export class AnimationStateMachine {
  private readonly states = new Map<string, AnimationState>();
  private current: string | null = null;
  /** Returns the selected gameplay animation state name, or null before selection. */
  get state(): string | null {
    return this.current;
  }
  /** Initializes named animation states and transition choices; invalid input is rejected. */
  constructor(
    readonly animator: Animator,
    states: Readonly<Record<string, AnimationState>>,
  ) {
    for (const [name, state] of Object.entries(states)) {
      if (
        !name ||
        !animator.clips[state.clip] ||
        !Number.isFinite(state.speed ?? 1) ||
        !Number.isFinite(state.fadeSeconds ?? 0.2) ||
        (state.fadeSeconds ?? 0.2) < 0
      )
        throw new Error("Invalid animation state");
      this.states.set(name, Object.freeze({ ...state }));
    }
  }
  /** Selects a named state and starts the configured crossfade only when changing state. */
  transition(name: string): boolean {
    const state = this.states.get(name);
    if (!state) throw new Error("Unknown animation state");
    if (this.current === name) return false;
    this.animator.loop = state.loop ?? true;
    this.animator.speed = state.speed ?? 1;
    if (this.current === null) this.animator.play(state.clip);
    else this.animator.crossFade(state.clip, state.fadeSeconds ?? 0.2);
    this.current = name;
    return true;
  }
  /** Explicit restart for one-shot attacks or replaying the current state. */
  restart(): void {
    if (this.current === null) return;
    const state = this.states.get(this.current)!;
    this.animator.stop();
    this.animator.play(state.clip);
  }
}
