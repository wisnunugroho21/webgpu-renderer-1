declare module "draco3dgltf/draco_decoder_gltf_nodejs.js" {
  const createDecoder: (options?: {
    wasmBinary: Uint8Array;
  }) => Promise<unknown>;
  export default createDecoder;
}
