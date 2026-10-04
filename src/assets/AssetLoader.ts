export type AssetState =
  | "Unloaded"
  | "Loading"
  | "Decoded"
  | "Uploading"
  | "Ready"
  | "Failed"
  | "Cancelled"
  | "Unloading";
export interface AssetRecord<Decoded, Uploaded> {
  readonly url: string;
  state: AssetState;
  readonly history: AssetState[];
  decoded?: Decoded;
  uploaded?: Uploaded;
  error?: unknown;
  pending?: Promise<Uploaded>;
  readonly timings: { networkMs: number; decodeMs: number; uploadMs: number };
  references: number;
  decodedBytes: number;
  lastUsed: number;
}
export interface AssetCacheBudget {
  maxRecords: number;
  maxDecodedBytes: number;
}
export interface AssetLoaderOptions<Decoded, Uploaded> {
  budget?: Partial<AssetCacheBudget>;
  decodedBytes?: (value: Decoded) => number;
  /** Detach consumers synchronously before the release callback fences GPU work. */
  beforeUnload?: (uploaded: Uploaded, decoded: Decoded, url: string) => void;
  release?: (uploaded: Uploaded) => Promise<void>;
  canEvict?: (record: AssetRecord<Decoded, Uploaded>) => boolean;
}
/** Cold asset work only. Cancellation applies to the deduplicated URL operation.
 * Budgets evict least-recently-used unretained records; live/pending assets may exceed them. */
export class AssetLoader<Network, Decoded, Uploaded> {
  readonly records = new Map<string, AssetRecord<Decoded, Uploaded>>();
  readonly budget: AssetCacheBudget;
  private readonly controllers = new Map<string, AbortController>();
  private readonly unloading = new Map<string, Promise<void>>();
  private clock = 0;
  private disposed = false;
  /** Initializes deduplicated asset states, cancellation and decoded-cache budgets. */
  constructor(
    private readonly network: (
      url: string,
      signal: AbortSignal,
    ) => Promise<Network>,
    private readonly decode: (
      data: Network,
      signal: AbortSignal,
    ) => Promise<Decoded>,
    private readonly upload: (
      data: Decoded,
      signal: AbortSignal,
    ) => Promise<Uploaded>,
    private readonly yieldTask = () =>
      /** Creates Promise storage for this operation. */ new Promise<void>(
        (resolve) =>
          /** Delegates this operation to setTimeout. */ setTimeout(resolve, 0),
      ),
    private readonly options: AssetLoaderOptions<Decoded, Uploaded> = {},
  ) {
    this.budget = {
      maxRecords: 64,
      maxDecodedBytes: 128 * 1024 * 1024,
      ...options.budget,
    };
    this.validateBudget(this.budget);
  }
  /** Rejects nonfinite or negative decoded-cache budget limits. */
  private validateBudget(budget: AssetCacheBudget): void {
    if (
      !Number.isSafeInteger(budget.maxRecords) ||
      budget.maxRecords < 0 ||
      !Number.isSafeInteger(budget.maxDecodedBytes) ||
      budget.maxDecodedBytes < 0
    )
      throw new Error("Invalid asset cache budget");
  }
  /** Applies record.history.shift, record.history.push to set. */
  private set(record: AssetRecord<Decoded, Uploaded>, state: AssetState): void {
    record.state = state;
    if (record.history.length === 64) record.history.shift();
    record.history.push(state);
  }
  /** Returns the URL cache record, creating its unloaded state on first access. */
  get(url: string): AssetRecord<Decoded, Uploaded> {
    let record = this.records.get(url);
    if (!record) {
      if (this.disposed) throw new Error("Asset loader disposed");
      record = {
        url,
        state: "Unloaded",
        history: ["Unloaded"],
        timings: { networkMs: 0, decodeMs: 0, uploadMs: 0 },
        references: 0,
        decodedBytes: 0,
        lastUsed: ++this.clock,
      };
      this.records.set(url, record);
    }
    this.trimEmptyRecords(url);
    return record;
  }
  /** Retain before load; release once the consumer has detached. Explicit unload overrides leases. */
  retain(url: string): () => void {
    if (this.disposed || this.unloading.has(url))
      throw new Error("Asset unavailable");
    const record = this.get(url);
    record.references++;
    let released = false;
    return () => {
      // Updates record references, released for this callback.

      if (!released) {
        record.references = Math.max(0, record.references - 1);
        released = true;
      }
    };
  }
  /** Deduplicates fetch/decode/upload work, handles cancellation and publishes one tracked asset record. */
  load(url: string): Promise<Uploaded> {
    if (this.disposed)
      return Promise.reject(new Error("Asset loader disposed"));
    if (this.unloading.has(url))
      return Promise.reject(new Error("Asset is unloading"));
    const record = this.get(url);
    record.lastUsed = ++this.clock;
    if (record.state === "Ready") return Promise.resolve(record.uploaded!);
    if (record.pending) return record.pending;
    if (record.state === "Unloading" || record.uploaded !== undefined)
      return Promise.reject(new Error("Asset cleanup required before reload"));
    const controller = new AbortController(),
      signal = controller.signal;
    this.controllers.set(url, controller);
    this.set(record, "Loading");
    record.error = undefined;
    Object.assign(record.timings, { networkMs: 0, decodeMs: 0, uploadMs: 0 });
    const pending = Promise.resolve().then(async () => {
      // Fetches, decodes and uploads the URL transaction with cancellation checks and rollback.

      let uploaded: Uploaded | undefined;
      try {
        signal.throwIfAborted();
        let start = performance.now();
        const data = await this.network(url, signal);
        signal.throwIfAborted();
        record.timings.networkMs = performance.now() - start;
        await this.yieldTask();
        signal.throwIfAborted();
        start = performance.now();
        record.decoded = await this.decode(data, signal);
        signal.throwIfAborted();
        record.timings.decodeMs = performance.now() - start;
        record.decodedBytes = this.options.decodedBytes?.(record.decoded) ?? 0;
        if (
          !Number.isSafeInteger(record.decodedBytes) ||
          record.decodedBytes < 0
        )
          throw new Error("Invalid decoded asset size");
        this.set(record, "Decoded");
        await this.yieldTask();
        signal.throwIfAborted();
        this.set(record, "Uploading");
        start = performance.now();
        uploaded = await this.upload(record.decoded, signal);
        signal.throwIfAborted();
        record.timings.uploadMs = performance.now() - start;
        await this.trimCache(url);
        signal.throwIfAborted();
        record.uploaded = uploaded;
        this.set(record, "Ready");
        return uploaded;
      } catch (error) {
        // An upload that ignores abort may finish late: release it instead of publishing it.
        let failure = error;
        if (uploaded !== undefined) {
          try {
            await this.options.release?.(uploaded);
          } catch (cleanupError) {
            record.uploaded = uploaded;
            failure = new AggregateError(
              [error, cleanupError],
              "Asset load and cleanup failed",
            );
          }
        }
        record.decoded = undefined;
        record.decodedBytes = 0;
        record.error = failure;
        if (record.state !== "Unloading")
          this.set(record, signal.aborted ? "Cancelled" : "Failed");
        throw failure;
      } finally {
        record.pending = undefined;
        this.controllers.delete(url);
        this.trimEmptyRecords(url);
      }
    });
    record.pending = pending;
    return pending;
  }
  /** Aborts a matching in-flight asset transaction and reports whether cancellation was requested. */
  cancel(url: string): boolean {
    const controller = this.controllers.get(url);
    if (!controller || controller.signal.aborted) return false;
    controller.abort(new DOMException("Asset load cancelled", "AbortError"));
    const record = this.records.get(url)!;
    if (record.state !== "Unloading") this.set(record, "Cancelled");
    return true;
  }
  /** Waits for cancellation cleanup. Concurrent unloads share the same operation. */
  unload(url: string): Promise<void> {
    const existing = this.unloading.get(url);
    if (existing) return existing;
    const record = this.records.get(url);
    if (!record) return Promise.resolve();
    // A consumer veto must leave the Ready record and every resource intact.
    try {
      if (record.state === "Ready")
        this.options.beforeUnload?.(record.uploaded!, record.decoded!, url);
    } catch (error) {
      return Promise.reject(error);
    }
    this.cancel(url);
    this.set(record, "Unloading");
    const operation = Promise.resolve()
      .then(async () => {
        // Waits for pending load settlement, releases uploaded ownership and removes the cache record.

        await record.pending?.catch(() => {
          // Intentionally performs no work at this optional callback boundary.
        });
        if (record.uploaded !== undefined)
          await this.options.release?.(record.uploaded);
        record.decoded = undefined;
        record.uploaded = undefined;
        record.decodedBytes = record.references = 0;
        this.set(record, "Unloaded");
        this.records.delete(url);
      })
      .finally(() =>
        /** Delegates this operation to this.unloading.delete. */ this.unloading.delete(
          url,
        ),
      );
    this.unloading.set(url, operation);
    return operation;
  }
  /** Failed/inspection-only metadata needs no asynchronous GPU release. */
  private trimEmptyRecords(protectedURL: string): void {
    if (this.records.size <= this.budget.maxRecords) return;
    const candidates = Array.from(this.records.values()).sort(
      (a, b) =>
        /** Computes the a.lastUsed - b.lastUsed result. */ a.lastUsed -
        b.lastUsed,
    );
    for (const record of candidates) {
      if (this.records.size <= this.budget.maxRecords) break;
      if (
        record.url !== protectedURL &&
        !record.references &&
        !record.pending &&
        record.decoded === undefined &&
        record.uploaded === undefined &&
        !this.unloading.has(record.url)
      )
        this.records.delete(record.url);
    }
  }
  /** Returns total retained decoded bytes for cache-budget accounting. */
  get cachedDecodedBytes(): number {
    let bytes = 0;
    for (const record of this.records.values()) bytes += record.decodedBytes;
    return bytes;
  }
  /** Updates the decoded-cache limit and trims unreferenced records to fit it. */
  async setCacheBudget(budget: Partial<AssetCacheBudget>): Promise<number> {
    const next = { ...this.budget, ...budget };
    this.validateBudget(next);
    Object.assign(this.budget, next);
    return this.trimCache();
  }
  /** Evicts unreferenced decoded data in least-recently-used order while honoring active ownership. */
  async trimCache(protectedURL?: string): Promise<number> {
    let evicted = 0;
    const candidates = Array.from(this.records.values()).sort(
      (a, b) =>
        /** Computes the a.lastUsed - b.lastUsed result. */ a.lastUsed -
        b.lastUsed,
    );
    for (const record of candidates) {
      if (
        this.records.size <= this.budget.maxRecords &&
        this.cachedDecodedBytes <= this.budget.maxDecodedBytes
      )
        break;
      if (
        record.url === protectedURL ||
        record.references ||
        record.pending ||
        this.unloading.has(record.url) ||
        this.records.get(record.url) !== record ||
        this.options.canEvict?.(record) === false
      )
        continue;
      await this.unload(record.url);
      evicted++;
    }
    return evicted;
  }
  /** Recovery boundary: abort in-flight uploads and finish retirement before managers change. */
  async quiesce(): Promise<void> {
    for (const url of this.controllers.keys()) this.cancel(url);
    await Promise.allSettled([
      ...Array.from(
        this.records.values(),
        (r) => /** Returns r pending. */ r.pending,
      ),
      ...this.unloading.values(),
    ]);
  }
  /** Cancels pending requests, drains cleanup and releases tracked resident asset state. */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const url of this.controllers.keys()) this.cancel(url);
    const results = await Promise.allSettled(
      Array.from(this.records.keys(), (url) =>
        /** Delegates this operation to this.unload. */ this.unload(url),
      ),
    );
    const errors = results.filter(
      (r): r is PromiseRejectedResult =>
        /** Evaluates the r.status === "rejected" condition. */ r.status ===
        "rejected",
    );
    if (errors.length)
      throw new AggregateError(
        errors.map((r) => /** Returns r reason. */ r.reason),
        "Asset disposal failed",
      );
  }
}
