/** Observable stages of one deduplicated URL transaction. */
export type AssetState =
  | "Unloaded"
  | "Loading"
  | "Decoded"
  | "Uploading"
  | "Ready"
  | "Failed"
  | "Cancelled"
  | "Unloading";
/** Cache-owned provenance and diagnostics; uploaded ownership lasts until successful unload. */
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
/** Soft decoded-cache limits; retained and pending consumers can exceed them. */
export interface AssetCacheBudget {
  maxRecords: number;
  maxDecodedBytes: number;
}
/** Cold lifecycle hooks supplied by the asset owner, separate from transaction scheduling. */
export interface AssetLoaderOptions<Decoded, Uploaded> {
  budget?: Partial<AssetCacheBudget>;
  decodedBytes?: (value: Decoded) => number;
  /** Detach consumers synchronously before the release callback fences GPU work. */
  beforeUnload?: (uploaded: Uploaded, decoded: Decoded, url: string) => void;
  release?: (uploaded: Uploaded) => Promise<void>;
  canEvict?: (record: AssetRecord<Decoded, Uploaded>) => boolean;
}
