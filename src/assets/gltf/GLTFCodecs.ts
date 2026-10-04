import dracoWasm from "draco3dgltf/draco_decoder_gltf.wasm?url";
import { JSONDocument, WebIO } from "@gltf-transform/core";
/** Decoder dependencies are loader-owned and lazy; failed Draco startup remains retryable. */
export class GLTFCodecs {
  /** Applies [ "KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu", "KHR_mesh_quantization", ].some, import, names.has to prepare. */
  async prepare(io: WebIO, document: JSONDocument): Promise<void> {
    const names = new Set(document.json.extensionsUsed ?? []);
    if (
      ![
        "KHR_draco_mesh_compression",
        "EXT_meshopt_compression",
        "KHR_texture_basisu",
        "KHR_mesh_quantization",
      ].some((name) =>
        /** Delegates this operation to names.has. */ names.has(name),
      )
    )
      return;
    const extensions = await import("@gltf-transform/extensions");
    const registered = [];
    if (names.has("KHR_mesh_quantization"))
      registered.push(extensions.KHRMeshQuantization);
    if (names.has("KHR_texture_basisu"))
      registered.push(extensions.KHRTextureBasisu);
    if (names.has("EXT_meshopt_compression")) {
      const { MeshoptDecoder } = await import("meshoptimizer");
      await MeshoptDecoder.ready;
      io.registerDependencies({ "meshopt.decoder": MeshoptDecoder });
      registered.push(extensions.EXTMeshoptCompression);
    }
    if (names.has("KHR_draco_mesh_compression")) {
      this.draco ??= (async () => {
        // Delegates this operation to createDecoder.

        const { default: createDecoder } =
          await import("draco3dgltf/draco_decoder_gltf_nodejs.js");
        const options =
          typeof location !== "undefined"
            ? {
                wasmBinary: new Uint8Array(
                  await (await fetch(dracoWasm)).arrayBuffer(),
                ),
              }
            : undefined;
        return createDecoder(options);
      })().catch((error) => {
        // Handles asynchronous failure so gltfcodecs can report or retire the failed operation.

        this.draco = undefined;
        throw error;
      });
      io.registerDependencies({ "draco3d.decoder": await this.draco });
      registered.push(extensions.KHRDracoMeshCompression);
    }
    io.registerExtensions(registered);
  }
  private draco?: Promise<unknown>;
}
