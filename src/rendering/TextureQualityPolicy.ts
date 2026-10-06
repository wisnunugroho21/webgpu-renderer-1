import type { RuntimeAsset } from "../assets/gltf/RuntimeAsset";
import type { StreamMemory } from "../assets/Streaming";
import type { Camera } from "./Camera";
import type { RenderWorld } from "./RenderWorld";
import type { RenderQueue } from "./RenderQueue";

export interface TextureQualityTier {
  key: string;
  /** Minimum projected object diameter in rendered pixels; ascending across tiers. */
  minPixels: number;
  /** Additional peak payload, including every mip and retained recovery source. */
  estimate: StreamMemory;
  load: () => Promise<RuntimeAsset>;
}
/** Copy and freeze cold tier configuration before the controller can reserve or replace assets. */
export function copyTextureQualityTiers(
  tiers: readonly TextureQualityTier[],
): readonly TextureQualityTier[] {
  if (!tiers.length || tiers.length > 8)
    throw new Error("Texture quality requires one to eight tiers");
  let previous = 0;
  return tiers.map((tier) => {
    // Copy authored cold configuration so later caller mutation cannot change admission estimates.
    if (
      !tier.key ||
      typeof tier.load !== "function" ||
      !Number.isFinite(tier.minPixels) ||
      tier.minPixels <= previous ||
      !Number.isSafeInteger(tier.estimate.gpuBytes) ||
      tier.estimate.gpuBytes < 0 ||
      !Number.isSafeInteger(tier.estimate.recoveryBytes) ||
      tier.estimate.recoveryBytes < 0
    )
      throw new Error("Invalid texture-quality tier");
    previous = tier.minPixels;
    return Object.freeze({
      ...tier,
      estimate: Object.freeze({ ...tier.estimate }),
    });
  });
}
/** Project conservative visible bounds into retained per-material scratch; never load or create GPU resources. */
export function observeTextureDemand(
  pixels: Float32Array,
  profiles: ReadonlyMap<number, unknown>,
  world: RenderWorld,
  queue: RenderQueue,
  camera: Camera,
  height: number,
): void {
  pixels.fill(0);
  const view = camera.view,
    projection = camera.projection;
  for (let rank = 0; rank < queue.count; rank++) {
    const object = queue.order[rank]!,
      material = world.materialId[object]!;
    if (!profiles.has(material)) continue;
    const o = object * 4,
      x = world.sphere[o]!,
      y = world.sphere[o + 1]!,
      z = world.sphere[o + 2]!,
      radius = world.sphere[o + 3]!;
    const depth = -(view[2]! * x + view[6]! * y + view[10]! * z + view[14]!);
    if (depth + radius < camera.near || depth - radius > camera.far) continue;
    const vx = view[0]! * x + view[4]! * y + view[8]! * z + view[12]!,
      vy = view[1]! * x + view[5]! * y + view[9]! * z + view[13]!;
    if (camera.projectionType === "orthographic") {
      if (
        Math.abs(vx) > 1 / projection[0]! + radius ||
        Math.abs(vy) > 1 / projection[5]! + radius
      )
        continue;
    } else if (
      Math.abs(vx) * projection[0]! >
        depth + radius * Math.hypot(projection[0]!, 1) ||
      Math.abs(vy) * projection[5]! >
        depth + radius * Math.hypot(projection[5]!, 1)
    )
      continue;
    const diameter =
      (radius * height * projection[5]!) /
      (camera.projectionType === "orthographic"
        ? 1
        : Math.max(camera.near, depth - radius));
    pixels[material] = Math.max(
      pixels[material]!,
      Math.min(16777216, diameter),
    );
  }
}
