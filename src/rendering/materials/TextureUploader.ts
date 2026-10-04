import { BasisTranscoder } from "../../assets/textures/BasisTranscoder";
import {
  compressedTexture,
  uploadCompressed,
} from "../../assets/textures/CompressedTexture";
import { RuntimeAsset } from "../../assets/gltf/RuntimeAsset";
import { Resources } from "../../gpu/Resources";
import { MipGenerator, mipLevelCount } from "./MipGenerator";

interface TextureUploadInput {
  readonly image: RuntimeAsset["textures"][number];
  readonly bytes: ArrayBuffer;
  readonly hash: string;
  readonly format: GPUTextureFormat;
  readonly basis: boolean;
  readonly role: string;
  readonly compressed?: ReturnType<typeof compressedTexture>;
  readonly bitmaps: Map<string, Promise<ImageBitmap>>;
}
interface TextureUploadMetrics {
  decodes: number;
  uploadBytes: number;
}

/** Cold image decoding and GPU upload. The material manager owns cache leases and bitmap cleanup.
 * A failed upload destroys its own partial texture before returning control to transaction rollback. */
export class TextureUploader {
  readonly basis: BasisTranscoder;
  readonly mipmaps: MipGenerator;
  /** Initializes decoded-image GPU upload and mip generation. */
  constructor(
    private readonly device: GPUDevice,
    private readonly resources: Resources,
    private readonly metrics: TextureUploadMetrics,
    private readonly isDisposed: () => boolean,
  ) {
    this.basis = new BasisTranscoder(device);
    this.mipmaps = new MipGenerator(device, resources);
  }
  /** Uploads decoded color/data images into the appropriate linear/sRGB texture format and prepares mip levels. */
  async upload(input: TextureUploadInput): Promise<GPUTexture> {
    const { image, bytes, hash, format, basis, role, compressed, bitmaps } =
      input;
    if (basis) {
      const data = await this.basis.decode(
        image.image,
        role === "baseColor" || role === "emissive",
      );
      if (this.isDisposed())
        throw new Error("Texture manager disposed during Basis decode");
      const texture = uploadCompressed(
        this.device,
        this.resources,
        data,
        image.name,
      );
      this.metrics.decodes++;
      this.metrics.uploadBytes += data.levels.reduce(
        (n, l) =>
          /** Computes the n + l.data.byteLength result. */ n +
          l.data.byteLength,
        0,
      );
      return texture;
    }
    if (compressed) {
      this.metrics.decodes++;
      const texture = uploadCompressed(
        this.device,
        this.resources,
        compressed,
        image.name,
      );
      this.metrics.uploadBytes += compressed.levels.reduce(
        (sum, level) =>
          /** Computes the sum + level.data.byteLength result. */ sum +
          level.data.byteLength,
        0,
      );
      return texture;
    }
    if (!bitmaps.has(hash)) {
      this.metrics.decodes++;
      bitmaps.set(
        hash,
        createImageBitmap(new Blob([bytes], { type: image.mimeType }), {
          colorSpaceConversion: "none",
          premultiplyAlpha: "none",
        }),
      );
    }
    const bitmap = await bitmaps.get(hash)!;
    if (this.isDisposed())
      throw new Error("Texture manager disposed during decode");
    if (
      bitmap.width > this.device.limits.maxTextureDimension2D ||
      bitmap.height > this.device.limits.maxTextureDimension2D
    )
      throw new Error("Texture exceeds device limits");
    const texture = this.resources.textures.create({
      label: image.name,
      size: [bitmap.width, bitmap.height],
      format,
      mipLevelCount: mipLevelCount(bitmap.width, bitmap.height),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        [bitmap.width, bitmap.height],
      );
      this.mipmaps.generate(texture);
      this.metrics.uploadBytes += bitmap.width * bitmap.height * 4;
      return texture;
    } catch (error) {
      this.resources.textures.destroy(texture);
      throw error;
    }
  }
}
