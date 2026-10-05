export interface StreamMemory {
  gpuBytes: number;
  recoveryBytes: number;
}
export interface StreamBudget {
  maxGPUBytes: number;
  maxRecoveryBytes: number;
  maxConcurrent: number;
  maxQueued: number;
}
export interface StreamRequest {
  /** Larger priorities are admitted first; equal priorities preserve FIFO order. */
  priority?: number;
  /** Additional peak payload reservation, not the total scene memory. Include all mip levels. */
  estimate?: Partial<StreamMemory>;
}
export class StreamBudgetError extends Error {
  /** Report admission/actual-size failure without evicting resources still owned by consumers. */
  constructor(message: string) {
    super(message);
    this.name = "StreamBudgetError";
  }
}
/** Validate an opt-in cold-streaming configuration before publishing any changed controls. */
export function streamBudget(
  value: Partial<StreamBudget>,
  previous?: StreamBudget,
): StreamBudget {
  const next = {
    maxGPUBytes: Infinity,
    maxRecoveryBytes: Infinity,
    maxConcurrent: 2,
    maxQueued: 256,
    ...previous,
    ...value,
  };
  for (const limit of [next.maxGPUBytes, next.maxRecoveryBytes])
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0))
      throw new Error("Invalid streaming byte budget");
  if (
    !Number.isSafeInteger(next.maxConcurrent) ||
    next.maxConcurrent < 1 ||
    next.maxConcurrent > 16 ||
    !Number.isSafeInteger(next.maxQueued) ||
    next.maxQueued < 1 ||
    next.maxQueued > 1024
  )
    throw new Error("Invalid streaming queue budget");
  return next;
}
/** Normalize caller estimates and priority before a request consumes a lease or starts loading. */
export function streamRequest(request: StreamRequest): {
  priority: number;
  estimate: StreamMemory;
} {
  const estimate = { gpuBytes: 0, recoveryBytes: 0, ...request.estimate },
    priority = request.priority ?? 0;
  for (const bytes of [estimate.gpuBytes, estimate.recoveryBytes])
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Invalid streaming estimate");
  if (!Number.isFinite(priority)) throw new Error("Invalid streaming priority");
  return { priority, estimate };
}
