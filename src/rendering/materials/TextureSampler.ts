import { RuntimeTextureSlot } from "../../assets/gltf/RuntimeAsset";
/** glTF filtering/wrap policy shared by material slots and fallback groups. Cold setup only. */
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
