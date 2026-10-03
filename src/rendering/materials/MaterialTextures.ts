import {
  compressedTexture,
  uploadCompressed,
} from "../../assets/textures/CompressedTexture";
import { MipGenerator, mipLevelCount } from "./MipGenerator";
import { Resources } from "../../gpu/Resources";
import {
  RuntimeAsset,
  RuntimeTextureSlot,
} from "../../assets/gltf/RuntimeAsset";
export const textureRoles = [
  "baseColor",
  "metallicRoughness",
  "normal",
  "occlusion",
  "emissive",
] as const;
export function samplerDescriptor(
  slot?: RuntimeTextureSlot,
  anisotropy = 1,
): GPUSamplerDescriptor {
  const wrap = (value: number): GPUAddressMode =>
    value === 33071
      ? "clamp-to-edge"
      : value === 33648
        ? "mirror-repeat"
        : "repeat";
  const min = slot?.minFilter ?? 9987;
  const linear =
    slot?.magFilter !== 9728 &&
    ![9728, 9984, 9986].includes(min) &&
    ![9984, 9985].includes(min);
  return {
    maxAnisotropy: linear
      ? Math.max(1, Math.min(16, Math.floor(anisotropy)))
      : 1,
    addressModeU: wrap(slot?.wrapS ?? 10497),
    addressModeV: wrap(slot?.wrapT ?? 10497),
    magFilter: slot?.magFilter === 9728 ? "nearest" : "linear",
    minFilter: [9728, 9984, 9986].includes(min) ? "nearest" : "linear",
    mipmapFilter: [9984, 9985].includes(min) ? "nearest" : "linear",
    lodMaxClamp: [9728, 9729].includes(min) ? 0 : 32,
  };
}
/** Cold-path material textures; all groups and sampler objects are reused by frames. */
export class MaterialTextures {
  readonly layout: GPUBindGroupLayout;
  readonly fallback: GPUBindGroup;
  readonly groups: GPUBindGroup[] = [];
  readonly mipmaps: MipGenerator;
  readonly cache = new Map<string, Promise<GPUTexture>>();
  private readonly references = new Map<string, number>();
  private readonly ownership = new WeakMap<GPUBindGroup[], Set<string>>();
  readonly metrics = { hits: 0, misses: 0, decodes: 0, uploadBytes: 0 };
  maxAnisotropy = 4;
  private disposed = false;
  private readonly white: GPUTextureView;
  private readonly flatNormal: GPUTextureView;
  constructor(
    private readonly device: GPUDevice,
    private readonly resources: Resources,
  ) {
    this.mipmaps = new MipGenerator(device, resources);
    this.layout = device.createBindGroupLayout({
      entries: textureRoles.flatMap((_, i) => [
        {
          binding: i * 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" as const },
        },
        {
          binding: i * 2 + 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" as const },
        },
      ]),
    });
    this.white = this.pixel([255, 255, 255, 255]);
    this.flatNormal = this.pixel([128, 128, 255, 255]);
    this.fallback = this.group();
  }
  private pixel(bytes: number[]): GPUTextureView {
    const texture = this.resources.textures.create({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture },
      new Uint8Array(bytes),
      { bytesPerRow: 4 },
      [1, 1],
    );
    return texture.createView();
  }
  private group(
    views?: GPUTextureView[],
    slots?: (RuntimeTextureSlot | undefined)[],
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.layout,
      entries: textureRoles.flatMap((_, i) => [
        {
          binding: i * 2,
          resource: views?.[i] ?? (i === 2 ? this.flatNormal : this.white),
        },
        {
          binding: i * 2 + 1,
          resource: this.resources.samplers.get(
            samplerDescriptor(slots?.[i], this.maxAnisotropy),
          ),
        },
      ]),
    });
  }
  dispose(): void {
    this.disposed = true;
    this.groups.length = 0;
    this.cache.clear();
  }
  async prepare(asset: RuntimeAsset): Promise<GPUBindGroup[]> {
    if (this.disposed) throw new Error("Texture manager disposed");
    const owned = new Set<string>();
    const bitmaps = new Map<string, Promise<ImageBitmap>>();
    const pending: Promise<GPUTextureView>[] = [];
    const view = async (
      slot: RuntimeTextureSlot,
      role: string,
    ): Promise<GPUTextureView> => {
      const image = asset.textures[slot.texture];
      if (!image) throw new Error("Unknown material texture");
      const bytes = image.image.slice().buffer;
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const compressed =
        image.mimeType === "image/ktx2"
          ? compressedTexture(
              image.image,
              role === "baseColor" || role === "emissive",
            )
          : undefined;
      const format: GPUTextureFormat =
        compressed?.format ??
        (role === "baseColor" || role === "emissive"
          ? "rgba8unorm-srgb"
          : "rgba8unorm");
      if (this.disposed) throw new Error("Texture manager disposed");
      const key = `${hash}:${format}`;
      if (!owned.has(key)) {
        owned.add(key);
        this.references.set(key, (this.references.get(key) ?? 0) + 1);
      }
      let cached = this.cache.get(key);
      if (cached) this.metrics.hits++;
      else {
        this.metrics.misses++;
        cached = (async () => {
          if (compressed) {
            this.metrics.decodes++;
            const texture = uploadCompressed(
              this.device,
              this.resources,
              compressed,
              image.name,
            );
            this.metrics.uploadBytes += compressed.levels.reduce(
              (sum, level) => sum + level.data.byteLength,
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
          if (this.disposed)
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
        })();
        this.cache.set(key, cached);
        const created = cached;
        void created.catch(() => {
          if (this.cache.get(key) === created) this.cache.delete(key);
        });
      }
      return (await cached).createView();
    };
    try {
      const groups = await Promise.all(
        asset.materials.map(async (material) => {
          const slots = textureRoles.map((role) => material.textures[role]);
          const textures = await Promise.all(
            slots.map((slot, i) =>
              slot
                ? (() => {
                    const result = view(slot, textureRoles[i]!);
                    pending.push(result);
                    return result;
                  })()
                : Promise.resolve(i === 2 ? this.flatNormal : this.white),
            ),
          );
          if (this.disposed) throw new Error("Texture manager disposed");
          return this.group(textures, slots);
        }),
      );
      this.ownership.set(groups, owned);
      return groups;
    } catch (error) {
      await Promise.allSettled(pending);
      await this.device.queue.onSubmittedWorkDone().catch(() => {});
      const failed: GPUBindGroup[] = [];
      this.ownership.set(failed, owned);
      await this.release(failed);
      throw error;
    } finally {
      await Promise.allSettled(pending);
      for (const bitmap of bitmaps.values()) {
        try {
          (await bitmap).close();
        } catch {
          /* propagate the original decode error */
        }
      }
    }
  }
  /** Caller must fence submitted GPU work and remove bound slots before releasing. */
  async release(groups: GPUBindGroup[]): Promise<void> {
    const owned = this.ownership.get(groups);
    if (!owned) return;
    this.ownership.delete(groups);
    for (const key of owned) {
      const count = (this.references.get(key) ?? 1) - 1;
      this.references.set(key, count);
      if (count) continue;
      const texture = await this.cache.get(key)?.catch(() => undefined);
      if ((this.references.get(key) ?? 0) !== 0) continue;
      this.references.delete(key);
      this.cache.delete(key);
      if (texture) this.resources.textures.destroy(texture);
    }
  }
}
