import { contentHash } from "../../assets/contentHash";
import {
  BasisTranscoder,
  isBasis,
} from "../../assets/textures/BasisTranscoder";
import { compressedTexture } from "../../assets/textures/CompressedTexture";
import { MipGenerator } from "./MipGenerator";
import { TextureUploader } from "./TextureUploader";
import { samplerDescriptor } from "./TextureSampler";
export { samplerDescriptor } from "./TextureSampler";
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
/** Cold-path material textures; all groups and sampler objects are reused by frames. */
export class MaterialTextures {
  readonly layout: GPUBindGroupLayout;
  private readonly basis: BasisTranscoder;
  private readonly uploader: TextureUploader;
  readonly fallback: GPUBindGroup;
  readonly groups: GPUBindGroup[] = [];
  readonly mipmaps: MipGenerator;
  readonly cache = new Map<string, Promise<GPUTexture>>();
  private readonly prepared = new Map<GPUBindGroup[], RuntimeAsset>();
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
    this.uploader = new TextureUploader(
      device,
      resources,
      this.metrics,
      () => this.disposed,
    );
    this.basis = this.uploader.basis;
    this.mipmaps = this.uploader.mipmaps;
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
    this.basis.dispose();
    this.groups.length = 0;
    this.cache.clear();
    this.prepared.clear();
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
      const hash = await contentHash(bytes);
      const basis = image.mimeType === "image/ktx2" && isBasis(image.image);
      const compressed =
        image.mimeType === "image/ktx2" && !basis
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
      const key = `${hash}:${basis ? "basis:" + format : format}`;
      if (!owned.has(key)) {
        owned.add(key);
        this.references.set(key, (this.references.get(key) ?? 0) + 1);
      }
      let cached = this.cache.get(key);
      if (cached) this.metrics.hits++;
      else {
        this.metrics.misses++;
        cached = this.uploader.upload({
          image,
          bytes,
          hash,
          format,
          basis,
          role,
          compressed,
          bitmaps,
        });
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
      this.prepared.set(groups, asset);
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
  /** Recreate texture leases and retain their identity mapping for asset/stream owners. */
  async rebuildInto(
    next: MaterialTextures,
  ): Promise<Map<GPUBindGroup[], GPUBindGroup[]>> {
    const arrays = new Map<GPUBindGroup[], GPUBindGroup[]>(),
      groups = new Map<GPUBindGroup, GPUBindGroup>([
        [this.fallback, next.fallback],
      ]);
    next.maxAnisotropy = this.maxAnisotropy;
    for (const [old, asset] of this.prepared) {
      const replacement = await next.prepare(asset);
      arrays.set(old, replacement);
      old.forEach((group, i) => groups.set(group, replacement[i]!));
    }
    this.groups.forEach((group, id) => {
      const replacement = groups.get(group);
      if (!replacement)
        throw new Error(
          `Material ${id} uses a custom GPU group without CPU recovery data`,
        );
      next.groups[id] = replacement;
    });
    return arrays;
  }
  /** Caller must fence submitted GPU work and remove bound slots before releasing. */
  async release(groups: GPUBindGroup[]): Promise<void> {
    const owned = this.ownership.get(groups);
    if (!owned) return;
    this.ownership.delete(groups);
    this.prepared.delete(groups);
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
