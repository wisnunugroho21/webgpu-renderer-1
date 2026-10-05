export type FixedUpdate = (
  stepSeconds: number,
  simulationSeconds: number,
) => void;
export type FrameUpdate = (deltaSeconds: number, alpha: number) => void;
interface Subscription<T> {
  callback: T;
  active: boolean;
}
/** Bounded fixed-step catch-up plus a variable update before animation/extraction.
 * Subscription arrays change only on registration; ordinary dispatch allocates nothing. */
export class SimulationLoop {
  private fixed: Subscription<FixedUpdate>[] = [];
  private updates: Subscription<FrameUpdate>[] = [];
  private accumulator = 0;
  simulationSeconds = 0;
  droppedSeconds = 0;
  alpha = 0;
  private step = 1 / 60;
  private tolerance = 1e-12;
  private maxDelta = 0.25;
  private maxSteps = 8;
  /** Validates fixed-step/catch-up limits and resets accumulated fractional time. */
  configure(options: {
    stepSeconds?: number;
    maxFrameSeconds?: number;
    maxSteps?: number;
  }): void {
    const step = options.stepSeconds ?? this.step,
      maxDelta = options.maxFrameSeconds ?? this.maxDelta,
      maxSteps = options.maxSteps ?? this.maxSteps;
    if (
      !Number.isFinite(step) ||
      step <= 0 ||
      !Number.isFinite(maxDelta) ||
      maxDelta <= 0 ||
      !Number.isSafeInteger(maxSteps) ||
      maxSteps < 1
    )
      throw new Error("Invalid simulation timing");
    this.step = step;
    this.tolerance = Math.min(1e-12, step * 1e-9);
    this.maxDelta = maxDelta;
    this.maxSteps = maxSteps;
    this.resetAccumulator();
  }
  /** Subscribes a fixed-step callback; the returned closure disables and removes that subscription. */
  onFixedUpdate(callback: FixedUpdate): () => void {
    return this.subscribe("fixed", callback);
  }
  /** Subscribes a once-per-frame callback receiving clamped delta seconds and fixed-step interpolation alpha. */
  onUpdate(callback: FrameUpdate): () => void {
    return this.subscribe("updates", callback);
  }
  /** Publishes a new subscription array so callbacks added during dispatch wait until the next dispatch. */
  private subscribe(
    kind: "fixed" | "updates",
    callback: FixedUpdate,
  ): () => void {
    const entry = { callback, active: true };
    // Replacing the array defers newly added callbacks until the next dispatch.
    this[kind] = [...this[kind], entry];
    return () => {
      // Deactivates and removes this subscription so later simulation/frame dispatches skip it.

      if (entry.active) {
        entry.active = false;
        this[kind] = this[kind].filter(
          (item) =>
            /** Keep every other subscriber when removing this registration. */ item !==
            entry,
        );
      }
    };
  }
  /** Clears fractional simulation time and interpolation alpha without resetting the simulation clock. */
  resetAccumulator(): void {
    this.accumulator = this.alpha = 0;
  }
  /** Advance authoritative ticks first, then presentation once with fractional interpolation alpha.
   * Excess elapsed time is counted and discarded instead of creating an unbounded catch-up loop.
   * Dispatch captures subscription arrays: new callbacks wait, while inactive ones are skipped immediately. */
  advance(deltaSeconds: number): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
      throw new Error("Invalid frame delta");
    const delta = Math.min(deltaSeconds, this.maxDelta);
    this.droppedSeconds += deltaSeconds - delta;
    this.accumulator += delta;
    const fixed = this.fixed,
      updates = this.updates;
    let steps = 0;
    while (
      this.accumulator + this.tolerance >= this.step &&
      steps < this.maxSteps
    ) {
      this.accumulator = Math.max(0, this.accumulator - this.step);
      this.simulationSeconds += this.step;
      steps++;
      for (const entry of fixed)
        if (entry.active) entry.callback(this.step, this.simulationSeconds);
    }
    if (this.accumulator >= this.step) {
      const dropped = Math.floor(this.accumulator / this.step) * this.step;
      this.accumulator -= dropped;
      this.droppedSeconds += dropped;
    }
    this.alpha = this.accumulator / this.step;
    for (const entry of updates)
      if (entry.active) entry.callback(delta, this.alpha);
    return delta;
  }
  /** Deactivates all subscriptions and clears interpolation state for teardown. */
  clear(): void {
    for (const entry of this.fixed) entry.active = false;
    for (const entry of this.updates) entry.active = false;
    this.fixed = [];
    this.updates = [];
    this.resetAccumulator();
  }
}
