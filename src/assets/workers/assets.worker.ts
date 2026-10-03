import { JSONDocument } from "@gltf-transform/core";
import { GLTFLoader } from "../gltf/GLTFLoader";
import { transferableBuffers } from "./transfer";
const loader = new GLTFLoader();
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; json: JSONDocument }>) => void;
  postMessage: (value: unknown, transfer?: ArrayBuffer[]) => void;
};
scope.onmessage = async (event) => {
  const { id, json } = event.data;
  try {
    const start = performance.now(),
      asset = await loader.parseJSON(json),
      decodeMs = performance.now() - start;
    scope.postMessage({ id, asset, decodeMs }, transferableBuffers(asset));
  } catch (error) {
    scope.postMessage({ id, error: String(error) });
  }
};
