import type { GPUContext } from "../../gpu/GPUContext";
import type { Resources } from "../../gpu/Resources";
import {
  particleAtlasMipLevels,
  type ParticleAtlasDefinition,
} from "../../particles/ParticleAtlas";
import { MipGenerator } from "../materials/MipGenerator";

/** Upload and generate the shared atlas only at installation/recovery; preserve tile-safe filtering and source ownership. */
export function createParticleAtlas(
  gpu: GPUContext,
  resources: Resources,
  atlas: ParticleAtlasDefinition | null,
  mipmaps?: MipGenerator,
) {
  const levels = particleAtlasMipLevels(atlas);
  const texture = resources.textures.create({
    label: "Particle atlas",
    mipLevelCount: levels,
    size: [atlas?.width ?? 1, atlas?.height ?? 1],
    format: atlas?.colorSpace === "linear" ? "rgba8unorm" : "rgba8unorm-srgb",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      (levels > 1 ? GPUTextureUsage.RENDER_ATTACHMENT : 0),
  });
  gpu.queue.writeTexture(
    { texture },
    atlas?.pixels ?? new Uint8Array([255, 255, 255, 255]),
    { bytesPerRow: (atlas?.width ?? 1) * 4 },
    [atlas?.width ?? 1, atlas?.height ?? 1],
  );
  if (levels > 1) {
    mipmaps ??= new MipGenerator(gpu.device, resources);
    mipmaps.generate(texture, true);
  }
  return { texture, levels, mipmaps };
}
