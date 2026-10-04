import type { AssetWorkerScope } from "./AssetWorkerProtocol";
import { prepareMesh } from "../../rendering/geometry/prepareMesh";
import { GLTFLoader } from "../gltf/GLTFLoader";
import { transferableBuffers } from "./transfer";
const loader = new GLTFLoader();
const scope = globalThis as unknown as AssetWorkerScope;
scope.onmessage = async (event) => {
  // Decodes and canonically prepares mesh data in the worker, then transfers engine arrays or a failure reply.

  const { id, json } = event.data;
  try {
    const start = performance.now(),
      asset = await loader.parseJSON(json),
      decodeMs = performance.now() - start;
    const prepareStart = performance.now();
    for (const mesh of asset.meshes)
      for (const primitive of mesh.primitives)
        primitive.prepared = prepareMesh(primitive);
    scope.postMessage(
      { id, asset, decodeMs, prepareMs: performance.now() - prepareStart },
      transferableBuffers(asset),
    );
  } catch (error) {
    scope.postMessage({ id, error: String(error) });
  }
};
