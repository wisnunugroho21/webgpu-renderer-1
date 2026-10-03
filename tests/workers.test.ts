import { it, expect, vi } from "vitest";
import { transferableBuffers } from "../src/assets/workers/transfer";
import { AssetDecoder } from "../src/assets/workers/AssetDecoder";
import { GLTFLoader } from "../src/assets/gltf/GLTFLoader";
import { JSONDocument } from "@gltf-transform/core";
it("deduplicates aliased buffers and transfers ownership without copies", () => {
  const data = new Float32Array([1, 2, 3]),
    view = new Uint8Array(data.buffer);
  const payload = { data, view },
    transfer = transferableBuffers(payload);
  expect(transfer).toEqual([data.buffer]);
  const copied = structuredClone(payload, { transfer });
  expect(data.byteLength).toBe(0);
  expect(Array.from(copied.data)).toEqual([1, 2, 3]);
  expect(copied.data.buffer).toBe(copied.view.buffer);
});
it("uses main decode for small assets and rejects worker jobs on disposal", async () => {
  const parseJSON = vi.fn(async () => ({ meshes: [] })),
    loader = { parseJSON } as unknown as GLTFLoader;
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
  vi.stubGlobal("Worker", function () {});
  const decoder = new AssetDecoder(loader, () => worker as unknown as Worker);
  const json = {
    json: { asset: { version: "2.0" } },
    resources: { data: new Uint8Array(4) },
  } as JSONDocument;
  await decoder.decode(json);
  expect(parseJSON).toHaveBeenCalledTimes(1);
  decoder.thresholdBytes = 0;
  const promise = decoder.decode(json);
  expect(worker.postMessage).toHaveBeenCalled();
  decoder.dispose();
  await expect(promise).rejects.toThrow("disposed");
  expect(worker.terminate).toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it("cancels one worker job without terminating other decodes or accepting a late response", async () => {
  vi.stubGlobal("Worker", function () {});
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: undefined as ((event: MessageEvent) => void) | undefined,
  };
  const decoder = new AssetDecoder(
    {} as GLTFLoader,
    () => worker as unknown as Worker,
  );
  decoder.thresholdBytes = 0;
  const json = {
    json: { asset: { version: "2.0" } },
    resources: {},
  } as JSONDocument;
  const controller = new AbortController();
  const a = decoder.decode(json, controller.signal),
    b = decoder.decode(json);
  controller.abort();
  await expect(a).rejects.toMatchObject({ name: "AbortError" });
  worker.onmessage!({ data: { id: 0, asset: { meshes: [] } } } as MessageEvent);
  worker.onmessage!({ data: { id: 1, asset: { meshes: [] } } } as MessageEvent);
  expect(await b).toEqual({ meshes: [] });
  expect(worker.terminate).not.toHaveBeenCalled();
  decoder.dispose();
  vi.unstubAllGlobals();
});
