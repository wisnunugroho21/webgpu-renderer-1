import {
  streamBudget,
  streamRequest,
  StreamBudgetError,
  type StreamMemory,
  type StreamBudget,
  type StreamRequest,
} from "./StreamingBudget";
export type {
  StreamMemory,
  StreamBudget,
  StreamRequest,
} from "./StreamingBudget";
export { StreamBudgetError } from "./StreamingBudget";
export interface StreamRecord<T> {
  readonly key: string;
  references: number;
  lastUsedFrame: number;
  value?: T;
  failedCleanup?: boolean;
  pending?: Promise<T>;
  destroy: (value: T) => void | Promise<void>;
}
export interface StreamLease<T> {
  readonly ready: Promise<T>;
  /** Updates the last-use frame without adding a resource reference. */
  touch(frame: number): void;
  /** Drops this lease reference once, allowing later eviction. */
  release(): void;
}
/** Eviction is asynchronous maintenance, never a frame-path GPU wait. */
export class Streaming<T> {
  readonly records = new Map<string, StreamRecord<T>>();
  private limits?: StreamBudget;
  private active = 0;
  private readonly retiring = new Set<string>();
  private readonly reserved: StreamMemory = { gpuBytes: 0, recoveryBytes: 0 };
  private readonly jobs: { priority: number; run: () => Promise<void> }[] = [];
  private maintenance: Promise<unknown> = Promise.resolve();
  /** Report cold admission state without creating GPU objects or scheduling frame work. */
  get diagnostics() {
    return {
      budget: this.limits ? { ...this.limits } : undefined,
      active: this.active,
      queued: this.jobs.length,
      reserved: { ...this.reserved },
      memory: this.usage(),
    };
  }
  /** Enable/update budget-aware loading; pinned resources may already exceed lowered limits. */
  setBudget(value: Partial<StreamBudget>): void {
    const next = streamBudget(value, this.limits);
    if (
      !this.memory &&
      (next.maxGPUBytes !== Infinity || next.maxRecoveryBytes !== Infinity)
    )
      throw new Error(
        "Finite streaming byte budgets require a memory provider",
      );
    this.limits = next;
    this.drain();
  }
  /** Start queued jobs by priority with bounded concurrency; asynchronous jobs always release their slots. */
  private drain(): void {
    while (this.jobs.length && this.active < this.limits!.maxConcurrent) {
      this.jobs.sort((a, b) => {
        /* Stable ordering preserves FIFO for equal priority. */ return (
          b.priority - a.priority
        );
      });
      const job = this.jobs.shift()!;
      this.active++;
      void job.run().finally(() => {
        /* Release the slot even after admission or cleanup failure. */ this
          .active--;
        this.drain();
      });
    }
  }
  /** Read validated payload accounting only at cold diagnostics/admission boundaries. */
  private usage(): StreamMemory {
    const memory = this.memory?.() ?? { gpuBytes: 0, recoveryBytes: 0 };
    if (
      !Number.isSafeInteger(memory.gpuBytes) ||
      memory.gpuBytes < 0 ||
      !Number.isSafeInteger(memory.recoveryBytes) ||
      memory.recoveryBytes < 0
    )
      throw new Error("Invalid streaming memory accounting");
    return memory;
  }
  /** Compare current global payload plus in-flight estimates against the opt-in limits. */
  private fits(extra: StreamMemory): boolean {
    const current = this.usage(),
      limits = this.limits!;
    return (
      current.gpuBytes + this.reserved.gpuBytes + extra.gpuBytes <=
        limits.maxGPUBytes &&
      current.recoveryBytes +
        this.reserved.recoveryBytes +
        extra.recoveryBytes <=
        limits.maxRecoveryBytes
    );
  }
  /** Serialize cold eviction/admission so concurrent grants cannot reserve the same headroom. */
  private serialize<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.maintenance.then(operation);
    this.maintenance = result.catch(() => {
      /* Keep later maintenance retryable after a rejected operation. */
    });
    return result;
  }
  /** Reclaim oldest unleased residents under pressure; recheck every candidate after the cold GPU fence. */
  private async reclaim(extra: StreamMemory): Promise<number> {
    if (this.fits(extra)) return 0;
    const candidates = [...this.records.values()]
      .filter((r) => {
        /* Pending resources and live consumers remain protected. */ return (
          !r.references && !r.pending && r.value !== undefined
        );
      })
      .sort((a, b) => {
        /* Pressure eviction prioritizes oldest use. */ return (
          a.lastUsedFrame - b.lastUsedFrame
        );
      });
    if (!candidates.length) return 0;
    await this.submittedWorkDone();
    let evicted = 0;
    for (const record of candidates) {
      if (this.fits(extra)) break;
      if (
        this.records.get(record.key) !== record ||
        record.references ||
        record.pending ||
        this.referenced(record.value!)
      )
        continue;
      // Keep ownership visible if destruction fails; a later maintenance call can retry.
      await this.retire(record);
      evicted++;
    }
    return evicted;
  }
  /** Block reacquisition while asynchronous destruction runs; failed cleanup stays tracked for retry. */
  private async retire(record: StreamRecord<T>): Promise<void> {
    this.retiring.add(record.key);
    try {
      await record.destroy(record.value!);
      if (this.records.get(record.key) === record)
        this.records.delete(record.key);
    } finally {
      this.retiring.delete(record.key);
    }
  }
  /** Trim budget pressure explicitly at a scene/streaming boundary, with no frame-path GPU wait. */
  trimBudget(): Promise<number> {
    if (!this.limits) return Promise.resolve(0);
    return this.serialize(() => {
      /* All pressure maintenance shares the admission barrier. */ return this.reclaim(
        { gpuBytes: 0, recoveryBytes: 0 },
      );
    });
  }
  /** Run or queue cold loading; estimates reserve peak headroom and actual accounting validates publication. */
  private schedule(
    load: () => Promise<T>,
    destroy: (value: T) => void | Promise<void>,
    request: ReturnType<typeof streamRequest>,
    cleanupFailed: (value: T) => void,
  ): Promise<T> {
    if (!this.limits) return load();
    if (this.jobs.length >= this.limits.maxQueued)
      return Promise.reject(
        new StreamBudgetError("Streaming queue capacity exceeded"),
      );
    return new Promise<T>((resolve, reject) => {
      // One queued closure belongs to a deduplicated request, never to an entity or frame.
      this.jobs.push({
        priority: request.priority,
        run: async () => {
          // Reserve before allocation, then reconcile measured residency before consumers can bind it.
          let reserved = false;
          let value: T | undefined;
          try {
            await this.serialize(async () => {
              // Evict only reclaimable records; pinned baseline allocations can refuse a request.
              await this.reclaim(request.estimate);
              if (!this.fits(request.estimate))
                throw new StreamBudgetError(
                  "Streaming budget is occupied by pinned resources or request exceeds budget",
                );
              this.reserved.gpuBytes += request.estimate.gpuBytes;
              this.reserved.recoveryBytes += request.estimate.recoveryBytes;
              reserved = true;
            });
            value = await load();
            // Other in-flight reservations are admission hints. Check measured global storage alone here.
            const current = this.usage();
            if (
              current.gpuBytes > this.limits!.maxGPUBytes ||
              current.recoveryBytes > this.limits!.maxRecoveryBytes
            )
              throw new StreamBudgetError(
                "Actual streamed resource exceeded memory budget",
              );
            resolve(value);
          } catch (error) {
            if (value !== undefined) {
              try {
                await this.submittedWorkDone();
                await destroy(value);
              } catch (cleanup) {
                cleanupFailed(value);
                reject(
                  new AggregateError(
                    [error, cleanup],
                    "Stream budget rollback failed",
                  ),
                );
                return;
              }
            }
            reject(error);
          } finally {
            if (reserved) {
              this.reserved.gpuBytes -= request.estimate.gpuBytes;
              this.reserved.recoveryBytes -= request.estimate.recoveryBytes;
            }
          }
        },
      });
      this.drain();
    });
  }
  /** Initializes resident streaming records and reference-aware eviction. */
  constructor(
    private readonly submittedWorkDone: () => Promise<void>,
    private readonly referenced: (value: T) => boolean = () =>
      /** Defaults to no external resource references beyond tracked leases. */ false,
    private readonly memory?: () => StreamMemory,
  ) {}
  /** Shares an existing resident/pending resource or starts its asynchronous load and increments references. */
  acquire(
    key: string,
    frame: number,
    load: () => Promise<T>,
    destroy: (value: T) => void | Promise<void>,
    request: StreamRequest = {},
  ): StreamLease<T> {
    if (this.retiring.has(key))
      throw new Error("Streaming resource is retiring");
    const options = streamRequest(request);
    let record = this.records.get(key);
    if (record?.failedCleanup)
      throw new Error("Streaming cleanup required before reload");
    if (!record) {
      record = { key, references: 0, lastUsedFrame: frame, destroy };
      this.records.set(key, record);
      const entry = record;
      entry.pending = Promise.resolve()
        .then(() => {
          /* Optional cold admission precedes the original loading callback. */ return this.schedule(
            load,
            destroy,
            options,
            (value) => {
              /* Preserve orphaned residency so later eviction can retry cleanup. */ entry.value =
                value;
              entry.failedCleanup = true;
            },
          );
        })
        .then(
          (value) => {
            // Publishes the loaded resource and clears its pending promise.

            entry.value = value;
            entry.pending = undefined;
            return value;
          },
          (error) => {
            // Removes the failed pending entry and propagates its error to lease consumers.

            entry.pending = undefined;
            if (!entry.failedCleanup && this.records.get(key) === entry)
              this.records.delete(key);
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
      /** Updates the last-used frame for a resident resource without changing ownership. */
      touch: (usedFrame) => {
        if (!released)
          entry.lastUsedFrame = Math.max(entry.lastUsedFrame, usedFrame);
      },
      /** Drops one resource reference while retaining the resident fallback until explicit eviction. */
      release: () => {
        if (!released) {
          entry.references--;
          released = true;
        }
      },
    };
  }
  /** Retires old zero-reference resources after queued GPU work is safe, rechecking ownership before release. */
  evictUnused(frame: number, minimumAge = 60): Promise<number> {
    if (this.limits)
      return this.serialize(() => {
        /* Age and pressure eviction cannot retire the same resource concurrently. */ return this.evictAge(
          frame,
          minimumAge,
        );
      });
    return this.evictAge(frame, minimumAge);
  }
  /** Apply age-based eviction while preserving historical lease and fence behavior. */
  private async evictAge(frame: number, minimumAge: number): Promise<number> {
    if (!Number.isSafeInteger(minimumAge) || minimumAge < 1)
      throw new Error("Eviction age must be at least one frame");
    const candidates = Array.from(this.records.values()).filter(
      (r) =>
        /** Evaluates the !r.references && !r.pending && frame - r.lastUsedFrame >= minimumAge condition. */ !r.references &&
        !r.pending &&
        frame - r.lastUsedFrame >= minimumAge,
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
      await this.retire(record);
      evicted++;
    }
    return evicted;
  }
}
