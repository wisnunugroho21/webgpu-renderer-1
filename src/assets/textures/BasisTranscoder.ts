import { read } from "ktx-parse";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import basisJS from "three/examples/jsm/libs/basis/basis_transcoder.js?url";
import basisWasm from "three/examples/jsm/libs/basis/basis_transcoder.wasm?url";
import { compressedTexture } from "./CompressedTexture";
/** Detects Basis Universal payloads requiring transcoding rather than native compressed upload. */
export function isBasis(bytes: Uint8Array): boolean {
  return read(bytes).vkFormat === 0;
}
export type TranscodedTexture = Omit<
  ReturnType<typeof compressedTexture>,
  "feature"
> & { feature?: GPUFeatureName };
/** Optional worker/WASM transcoder, owned by one texture manager and created only on demand. */
export class BasisTranscoder {
  private readonly loaders = new Map<boolean, Promise<KTX2Loader>>();
  private disposed = false;
  /** Initializes lazy Basis texture transcoding with adapter-compatible output. */
  constructor(private readonly device: GPUDevice) {}
  /** Transcodes Basis KTX2 data into a supported compressed GPU format or an RGBA fallback. */
  async decode(bytes: Uint8Array, srgb: boolean): Promise<TranscodedTexture> {
    if (this.disposed) throw new Error("Basis transcoder disposed");
    const container = read(bytes),
      dfd = container.dataFormatDescriptor[0];
    if (
      container.faceCount !== 1 ||
      container.layerCount ||
      container.pixelDepth ||
      !container.pixelWidth ||
      !container.pixelHeight ||
      !dfd ||
      dfd.flags
    )
      throw new Error("Only straight-alpha 2D Basis textures are supported");
    if (
      container.keyValue.KTXorientation &&
      container.keyValue.KTXorientation !== "rd"
    )
      throw new Error("Basis texture orientation must be rd");
    if (
      container.keyValue.KTXswizzle &&
      container.keyValue.KTXswizzle !== "rgba"
    )
      throw new Error("Basis texture swizzle must be rgba");
    if (dfd.colorPrimaries !== 0 && dfd.colorPrimaries !== 1)
      throw new Error("Basis textures require Rec.709 color primaries");
    if (
      Math.max(container.pixelWidth, container.pixelHeight) >
      this.device.limits.maxTextureDimension2D
    )
      throw new Error("Basis texture exceeds device limits");
    const three = await import("three");
    const rgba =
      container.pixelWidth % 4 !== 0 || container.pixelHeight % 4 !== 0;
    let pending = this.loaders.get(rgba);
    if (!pending) {
      pending = (async () => {
        // Returns loader.

        const { KTX2Loader } =
          await import("three/addons/loaders/KTX2Loader.js");
        const manager = new three.LoadingManager().setURLModifier((url) =>
          /** Selects the result according to url.endsWith("basis_transcoder.js"). */ url.endsWith(
            "basis_transcoder.js",
          )
            ? basisJS
            : url.endsWith("basis_transcoder.wasm")
              ? basisWasm
              : url,
        );
        const loader = new KTX2Loader(manager)
          .setTranscoderPath("/basis/")
          .setWorkerLimit(1);
        // KTX2Loader accepts a feature-reporting adapter; no Three renderer is constructed.
        loader.detectSupport({
          isWebGPURenderer: true,
          /** Checks the supplied adapter capability set before selecting compressed output. */
          hasFeature: (feature: string) =>
            !rgba && this.device.features.has(feature as GPUFeatureName),
        } as unknown as Parameters<KTX2Loader["detectSupport"]>[0]);
        return loader;
      })().catch((error) => {
        // Handles asynchronous failure so basis transcoder can report or retire the failed operation.

        this.loaders.delete(rgba);
        throw error;
      });
      this.loaders.set(rgba, pending);
    }
    const loader = await pending;
    const texture = await new Promise<import("three").CompressedTexture>(
      (resolve, reject) =>
        /** Delegates this operation to loader.parse. */ loader.parse(
          bytes.slice().buffer,
          resolve,
          reject,
        ),
    );
    try {
      if (this.disposed)
        throw new Error("Basis transcoder disposed during decode");
      const formats = new Map<
        number,
        [string, GPUFeatureName | undefined, number, number]
      >([
        [
          three.RGBA_ASTC_4x4_Format,
          ["astc-4x4-unorm", "texture-compression-astc", 4, 16],
        ],
        [
          three.RGBA_BPTC_Format,
          ["bc7-rgba-unorm", "texture-compression-bc", 4, 16],
        ],
        [
          three.RGB_ETC2_Format,
          ["etc2-rgb8unorm", "texture-compression-etc2", 4, 8],
        ],
        [
          three.RGBA_ETC2_EAC_Format,
          ["etc2-rgba8unorm", "texture-compression-etc2", 4, 16],
        ],
        [
          three.RGB_S3TC_DXT1_Format,
          ["bc1-rgba-unorm", "texture-compression-bc", 4, 8],
        ],
        [
          three.RGBA_S3TC_DXT1_Format,
          ["bc1-rgba-unorm", "texture-compression-bc", 4, 8],
        ],
        [
          three.RGBA_S3TC_DXT5_Format,
          ["bc3-rgba-unorm", "texture-compression-bc", 4, 16],
        ],
        [three.RGBAFormat, ["rgba8unorm", undefined, 1, 4]],
      ]);
      const info = formats.get(texture.format);
      if (!info || texture.type !== three.UnsignedByteType)
        throw new Error("Unsupported Basis transcode output");
      const [format, feature, block, blockBytes] = info;
      const levels = texture.mipmaps.map((level, mip) => {
        // Builds a record containing data, width, height, bytes per row, rows.

        const width = Math.max(1, container.pixelWidth >> mip),
          height = Math.max(1, container.pixelHeight >> mip),
          columns = Math.ceil(width / block),
          rows = Math.ceil(height / block);
        const data = level.data;
        if (
          !(data instanceof Uint8Array) ||
          data.byteLength !== columns * rows * blockBytes
        )
          throw new Error("Invalid Basis mip data");
        return {
          data: data.slice(),
          width: columns * block,
          height: rows * block,
          bytesPerRow: columns * blockBytes,
          rows,
        };
      });
      if (!levels.length) throw new Error("Basis texture has no mipmaps");
      return {
        format: (format + (srgb ? "-srgb" : "")) as GPUTextureFormat,
        feature,
        width: container.pixelWidth,
        height: container.pixelHeight,
        levels,
      };
    } finally {
      texture.dispose();
    }
  }
  /** Terminates the lazy transcoder worker and rejects outstanding requests. */
  dispose(): void {
    this.disposed = true;
    for (const loader of this.loaders.values())
      void loader.then(
        (value) =>
          /** Continues basis transcoder after the preceding asynchronous operation succeeds. */ value.dispose(),
        () => {
          // Intentionally performs no work at this optional callback boundary.
        },
      );
    this.loaders.clear();
  }
}
