import dracoWasm from "draco3dgltf/draco_decoder_gltf.wasm?url";
import { JSONDocument, WebIO } from "@gltf-transform/core";
/** Decoder dependencies are loader-owned and lazy; failed Draco startup remains retryable. */
export class GLTFCodecs {
  /** Applies [ "KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu", "KHR_mesh_quantization",
        "KHR_materials_transmission",
        "KHR_materials_volume",
        "KHR_materials_clearcoat", "KHR_materials_ior", "KHR_materials_specular", "KHR_materials_emissive_strength", "KHR_materials_unlit", "KHR_texture_transform", ].some, import, names.has to prepare. */
  async prepare(io: WebIO, document: JSONDocument): Promise<void> {
    const names = new Set(document.json.extensionsUsed ?? []);
    if (
      ![
        "KHR_draco_mesh_compression",
        "EXT_meshopt_compression",
        "KHR_texture_basisu",
        "KHR_mesh_quantization",
        "KHR_materials_transmission",
        "KHR_materials_volume",
        "KHR_materials_clearcoat",
        "KHR_materials_ior",
        "KHR_materials_specular",
        "KHR_materials_emissive_strength",
        "KHR_materials_unlit",
        "KHR_texture_transform",
      ].some((name) =>
        /** Delegates this operation to names.has. */ names.has(name),
      )
    )
      return;
    const extensions = await import("@gltf-transform/extensions");
    const registered = [];
    for (const [name, extension] of [
      ["KHR_materials_transmission", extensions.KHRMaterialsTransmission],
      ["KHR_materials_volume", extensions.KHRMaterialsVolume],
      ["KHR_materials_clearcoat", extensions.KHRMaterialsClearcoat],
      ["KHR_materials_ior", extensions.KHRMaterialsIOR],
      ["KHR_materials_specular", extensions.KHRMaterialsSpecular],
      [
        "KHR_materials_emissive_strength",
        extensions.KHRMaterialsEmissiveStrength,
      ],
      ["KHR_materials_unlit", extensions.KHRMaterialsUnlit],
      ["KHR_texture_transform", extensions.KHRTextureTransform],
    ] as const)
      if (names.has(name)) registered.push(extension);
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
