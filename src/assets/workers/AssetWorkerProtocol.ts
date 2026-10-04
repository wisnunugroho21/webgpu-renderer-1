import type { JSONDocument } from "@gltf-transform/core";
import type { RuntimeAsset } from "../gltf/RuntimeAsset";
export interface AssetDecodeRequest {
  id: number;
  json: JSONDocument;
}
export interface AssetDecodeReply {
  id: number;
  asset?: RuntimeAsset;
  error?: string;
  decodeMs?: number;
  prepareMs?: number;
}
/** Worker-only surface avoids mixing document/UI ownership into transferable preparation. */
export interface AssetWorkerScope {
  onmessage: (event: MessageEvent<AssetDecodeRequest>) => void;
  postMessage: (value: AssetDecodeReply, transfer?: ArrayBuffer[]) => void;
}
