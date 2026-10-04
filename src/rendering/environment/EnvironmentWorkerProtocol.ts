import type { EnvironmentData } from "./EnvironmentData";
import type { EnvironmentBakeOptions } from "./bakeEnvironment";
export interface PreparedEnvironment {
  data: EnvironmentData;
  precomputed: boolean;
}
export interface EnvironmentPrepareRequest {
  id: number;
  bytes: Uint8Array;
  options: EnvironmentBakeOptions;
}
export type EnvironmentPrepareReply =
  | (PreparedEnvironment & { id: number; prepareMs: number })
  | { id: number; error: string };
export interface EnvironmentWorkerScope {
  onmessage: (event: MessageEvent<EnvironmentPrepareRequest>) => void;
  postMessage: (
    value: EnvironmentPrepareReply,
    transfer?: ArrayBuffer[],
  ) => void;
}
