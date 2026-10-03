import { JSONDocument } from "@gltf-transform/core";
import { GLTFLoader } from "../gltf/GLTFLoader";
import { RuntimeAsset } from "../gltf/RuntimeAsset";
import { transferableBuffers } from "./transfer";
/** Profiling threshold keeps worker startup/round-trip overhead out of small assets. */
export class AssetDecoder {
  thresholdBytes = 1024 * 1024;
  readonly metrics = {
    workerJobs: 0,
    mainJobs: 0,
    transferredInputBytes: 0,
    transferredOutputBytes: 0,
    lastWorkerDecodeMs: 0,
  };
  private worker?: Worker;
  private nextId = 0;
  private disposed = false;
  private readonly pending = new Map<
    number,
    { resolve: (asset: RuntimeAsset) => void; reject: (error: Error) => void }
  >();
  constructor(
    private readonly loader: GLTFLoader,
    private readonly factory = () =>
      new Worker(new URL("./assets.worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {}
  async decode(
    json: JSONDocument,
    signal?: AbortSignal,
  ): Promise<RuntimeAsset> {
    signal?.throwIfAborted();
    if (this.disposed) throw new Error("Asset decoder disposed");
    const transfer = transferableBuffers(json),
      bytes = transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    if (bytes < this.thresholdBytes || typeof Worker === "undefined") {
      this.metrics.mainJobs++;
      const asset = await this.loader.parseJSON(json);
      signal?.throwIfAborted();
      return asset;
    }
    if (!this.worker) {
      this.worker = this.factory();
      this.worker.onmessage = (
        event: MessageEvent<{
          id: number;
          asset?: RuntimeAsset;
          error?: string;
          decodeMs?: number;
        }>,
      ) => {
        const job = this.pending.get(event.data.id);
        if (!job) return;
        this.pending.delete(event.data.id);
        if (event.data.error) job.reject(new Error(event.data.error));
        else if (event.data.asset) {
          this.metrics.transferredOutputBytes += transferableBuffers(
            event.data.asset,
          ).reduce((sum, buffer) => sum + buffer.byteLength, 0);
          this.metrics.lastWorkerDecodeMs = event.data.decodeMs ?? 0;
          job.resolve(event.data.asset);
        } else job.reject(new Error("Worker returned no asset"));
      };
      this.worker.onerror = (event) => {
        const error = new Error(event.message || "Asset worker failed");
        for (const job of this.pending.values()) job.reject(error);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = undefined;
      };
    }
    const id = this.nextId++;
    return new Promise<RuntimeAsset>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(signal!.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve: (asset) => {
          signal?.removeEventListener("abort", abort);
          resolve(asset);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      });
      try {
        this.worker!.postMessage({ id, json }, transfer);
        this.metrics.workerJobs++;
        this.metrics.transferredInputBytes += bytes;
      } catch (error) {
        signal?.removeEventListener("abort", abort);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = undefined;
    for (const job of this.pending.values())
      job.reject(new Error("Asset decoder disposed"));
    this.pending.clear();
  }
}
