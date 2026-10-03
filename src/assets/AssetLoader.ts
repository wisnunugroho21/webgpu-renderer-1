export type AssetState =
  "Unloaded" | "Loading" | "Decoded" | "Uploading" | "Ready" | "Failed";
export interface AssetRecord<Decoded, Uploaded> {
  readonly url: string;
  state: AssetState;
  readonly history: AssetState[];
  decoded?: Decoded;
  uploaded?: Uploaded;
  error?: unknown;
  pending?: Promise<Uploaded>;
  readonly timings: { networkMs: number; decodeMs: number; uploadMs: number };
}
/** Cold asset work is separate from the frame. Concurrent requests share one pipeline. */
export class AssetLoader<Network, Decoded, Uploaded> {
  readonly records = new Map<string, AssetRecord<Decoded, Uploaded>>();
  constructor(
    private readonly network: (url: string) => Promise<Network>,
    private readonly decode: (data: Network) => Promise<Decoded>,
    private readonly upload: (data: Decoded) => Promise<Uploaded>,
    private readonly yieldTask = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 0)),
  ) {}
  get(url: string): AssetRecord<Decoded, Uploaded> {
    let record = this.records.get(url);
    if (!record) {
      record = {
        url,
        state: "Unloaded",
        history: ["Unloaded"],
        timings: { networkMs: 0, decodeMs: 0, uploadMs: 0 },
      };
      this.records.set(url, record);
    }
    return record;
  }
  load(url: string): Promise<Uploaded> {
    const record = this.get(url);
    if (record.state === "Ready") return Promise.resolve(record.uploaded!);
    if (record.pending) return record.pending;
    const set = (state: AssetState) => {
      record.state = state;
      record.history.push(state);
    };
    set("Loading");
    record.error = undefined;
    const pending = Promise.resolve().then(async () => {
      try {
        let start = performance.now();
        const data = await this.network(url);
        record.timings.networkMs = performance.now() - start;
        await this.yieldTask();
        start = performance.now();
        record.decoded = await this.decode(data);
        record.timings.decodeMs = performance.now() - start;
        set("Decoded");
        await this.yieldTask();
        set("Uploading");
        start = performance.now();
        record.uploaded = await this.upload(record.decoded);
        record.timings.uploadMs = performance.now() - start;
        set("Ready");
        return record.uploaded;
      } catch (error) {
        record.error = error;
        set("Failed");
        throw error;
      } finally {
        record.pending = undefined;
      }
    });
    record.pending = pending;
    return pending;
  }
}
