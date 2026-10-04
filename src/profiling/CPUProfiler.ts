export const CPUStage = {
  simulation: 0,
  animation: 1,
  transforms: 2,
  skeletons: 3,
  animatedBounds: 4,
  extraction: 5,
  culling: 6,
  sorting: 7,
  encoding: 8,
} as const;
/** Fixed circular samples; stage intervals may be accumulated, never allocate in frames. */
export class CPUProfiler {
  readonly values = new Float64Array(9);
  readonly history: Float64Array;
  readonly totals: Float64Array;
  private readonly starts = new Float64Array(9);
  frames = 0;
  private frameStart = 0;
  /** Initializes fixed CPU-stage timing history. */
  constructor(
    readonly capacity = 600,
    private readonly now: () => number = () =>
      /** Delegates this operation to performance.now. */ performance.now(),
  ) {
    this.history = new Float64Array(capacity * 9);
    this.totals = new Float64Array(capacity);
  }
  /** Resets current CPU-stage samples before frame preparation. */
  beginFrame(): void {
    this.values.fill(0);
    this.frameStart = this.now();
  }
  /** Stores the monotonic start timestamp for one CPU stage. */
  start(stage: number): void {
    this.starts[stage] = this.now();
  }
  /** Accumulates elapsed milliseconds for the selected stage. */
  end(stage: number): void {
    this.values[stage]! += Math.max(0, this.now() - this.starts[stage]!);
  }
  /** Publishes current CPU durations into the fixed history ring. */
  finishFrame(): void {
    const slot = this.frames++ % this.capacity;
    this.history.set(this.values, slot * 9);
    this.totals[slot] = Math.max(0, this.now() - this.frameStart);
  }
}
