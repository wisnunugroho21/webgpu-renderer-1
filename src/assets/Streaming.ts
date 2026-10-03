export interface StreamRecord<T> {
  readonly key: string;
  references: number;
  lastUsedFrame: number;
  value?: T;
  pending?: Promise<T>;
  destroy: (value: T) => void | Promise<void>;
}
export interface StreamLease<T> {
  readonly ready: Promise<T>;
  touch(frame: number): void;
  release(): void;
}
/** Eviction is asynchronous maintenance, never a frame-path GPU wait. */
export class Streaming<T> {
  readonly records = new Map<string, StreamRecord<T>>();
  constructor(
    private readonly submittedWorkDone: () => Promise<void>,
    private readonly referenced: (value: T) => boolean = () => false,
  ) {}
  acquire(
    key: string,
    frame: number,
    load: () => Promise<T>,
    destroy: (value: T) => void | Promise<void>,
  ): StreamLease<T> {
    let record = this.records.get(key);
    if (!record) {
      record = { key, references: 0, lastUsedFrame: frame, destroy };
      this.records.set(key, record);
      const entry = record;
      entry.pending = Promise.resolve()
        .then(load)
        .then(
          (value) => {
            entry.value = value;
            entry.pending = undefined;
            return value;
          },
          (error) => {
            if (this.records.get(key) === entry) this.records.delete(key);
            throw error;
          },
        );
    }
    record.references++;
    record.lastUsedFrame = Math.max(record.lastUsedFrame, frame);
    const entry = record;
    let released = false;
    return {
      ready: entry.pending ?? Promise.resolve(entry.value!),
      touch: (usedFrame) => {
        if (!released)
          entry.lastUsedFrame = Math.max(entry.lastUsedFrame, usedFrame);
      },
      release: () => {
        if (!released) {
          entry.references--;
          released = true;
        }
      },
    };
  }
  async evictUnused(frame: number, minimumAge = 60): Promise<number> {
    if (!Number.isSafeInteger(minimumAge) || minimumAge < 1)
      throw new Error("Eviction age must be at least one frame");
    const candidates = Array.from(this.records.values()).filter(
      (r) =>
        !r.references && !r.pending && frame - r.lastUsedFrame >= minimumAge,
    );
    if (!candidates.length) return 0;
    await this.submittedWorkDone();
    let evicted = 0;
    for (const record of candidates) {
      if (
        this.records.get(record.key) !== record ||
        record.references ||
        this.referenced(record.value!) ||
        record.pending ||
        frame - record.lastUsedFrame < minimumAge
      )
        continue;
      this.records.delete(record.key);
      await record.destroy(record.value!);
      evicted++;
    }
    return evicted;
  }
}
