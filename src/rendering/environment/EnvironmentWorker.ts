import type {
  PreparedEnvironment,
  EnvironmentPrepareReply,
} from "./EnvironmentWorkerProtocol";
import { EnvironmentBakeOptions } from "./bakeEnvironment";
import { prepareEnvironment } from "./prepareEnvironment";
/** Lazy reusable worker. Clear terminates CPU jobs and rejects their owners before retirement. */
export class EnvironmentWorker {
  enabled = true;
  readonly metrics = { jobs: 0, lastPrepareMs: 0 };
  private worker?: Worker;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (data: PreparedEnvironment) => void;
      reject: (error: Error) => void;
    }
  >();
  constructor(
    private readonly factory = () =>
      new Worker(new URL("./environment.worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {}
  prepare(
    bytes: Uint8Array,
    options: EnvironmentBakeOptions,
  ): Promise<PreparedEnvironment> {
    if (!this.enabled || typeof Worker === "undefined")
      return prepareEnvironment(bytes, options);
    if (!this.worker) {
      this.worker = this.factory();
      this.worker.onmessage = (
        event: MessageEvent<EnvironmentPrepareReply>,
      ) => {
        const pending = this.pending.get(event.data.id);
        if (!pending) return;
        this.pending.delete(event.data.id);
        if ("error" in event.data) pending.reject(new Error(event.data.error));
        else {
          this.metrics.lastPrepareMs = event.data.prepareMs;
          pending.resolve(event.data);
        }
      };
      this.worker.onerror = (event) =>
        this.clear(new Error(event.message || "Environment worker failed"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker!.postMessage({ id, bytes, options }, [bytes.buffer]);
        this.metrics.jobs++;
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  clear(error = new Error("Environment preparation cleared")): void {
    this.worker?.terminate();
    this.worker = undefined;
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
  }
}
