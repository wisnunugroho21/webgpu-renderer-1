import { read } from "ktx-parse";
import { Resources } from "../../gpu/Resources";
interface BlockFormat {
  format: GPUTextureFormat;
  feature: GPUFeatureName;
  width: number;
  height: number;
  bytes: number;
  srgb: boolean;
}
const formats = new Map<number, BlockFormat>();
const add = (
  vk: number,
  format: string,
  feature: GPUFeatureName,
  bytes: number,
  width = 4,
  height = 4,
  srgb = true,
): void => {
  const info = {
    format: format as GPUTextureFormat,
    feature,
    width,
    height,
    bytes,
    srgb,
  };
  formats.set(vk, info);
  if (srgb) formats.set(vk + 1, info);
};
add(133, "bc1-rgba-unorm", "texture-compression-bc", 8);
add(135, "bc2-rgba-unorm", "texture-compression-bc", 16);
add(137, "bc3-rgba-unorm", "texture-compression-bc", 16);
add(139, "bc4-r-unorm", "texture-compression-bc", 8, 4, 4, false);
add(140, "bc4-r-snorm", "texture-compression-bc", 8, 4, 4, false);
add(141, "bc5-rg-unorm", "texture-compression-bc", 16, 4, 4, false);
add(142, "bc5-rg-snorm", "texture-compression-bc", 16, 4, 4, false);
add(143, "bc6h-rgb-ufloat", "texture-compression-bc", 16, 4, 4, false);
add(144, "bc6h-rgb-float", "texture-compression-bc", 16, 4, 4, false);
add(145, "bc7-rgba-unorm", "texture-compression-bc", 16);
add(147, "etc2-rgb8unorm", "texture-compression-etc2", 8);
add(149, "etc2-rgb8a1unorm", "texture-compression-etc2", 8);
add(151, "etc2-rgba8unorm", "texture-compression-etc2", 16);
add(153, "eac-r11unorm", "texture-compression-etc2", 8, 4, 4, false);
add(154, "eac-r11snorm", "texture-compression-etc2", 8, 4, 4, false);
add(155, "eac-rg11unorm", "texture-compression-etc2", 16, 4, 4, false);
add(156, "eac-rg11snorm", "texture-compression-etc2", 16, 4, 4, false);
for (const [i, size] of [
  [4, 4],
  [5, 4],
  [5, 5],
  [6, 5],
  [6, 6],
  [8, 5],
  [8, 6],
  [8, 8],
  [10, 5],
  [10, 6],
  [10, 8],
  [10, 10],
  [12, 10],
  [12, 12],
].entries())
  add(
    157 + i * 2,
    `astc-${size[0]}x${size[1]}-unorm`,
    "texture-compression-astc",
    16,
    size[0],
    size[1],
  );
export function compressedTexture(bytes: Uint8Array, srgb: boolean) {
  const container = read(bytes),
    block = formats.get(container.vkFormat);
  if (container.supercompressionScheme || !block)
    throw new Error(
      "KTX2 requires native BC/ETC2/ASTC blocks; transcode Basis/supercompressed input before upload",
    );
  if (
    container.faceCount !== 1 ||
    container.layerCount ||
    container.pixelDepth ||
    !container.pixelWidth ||
    !container.pixelHeight ||
    container.typeSize !== 1
  )
    throw new Error("Only 2D compressed textures are supported");
  if (srgb && !block.srgb)
    throw new Error("Compressed data format has no sRGB variant");
  if (
    container.keyValue.KTXorientation &&
    container.keyValue.KTXorientation !== "rd"
  )
    throw new Error("KTX2 orientation must be rd");
  if (container.keyValue.KTXswizzle && container.keyValue.KTXswizzle !== "rgba")
    throw new Error("KTX2 swizzle must be rgba");
  if (
    container.pixelWidth % block.width ||
    container.pixelHeight % block.height
  )
    throw new Error("Compressed base dimensions must align to texel blocks");
  if (
    !container.levels.length ||
    container.levels.length !== container.levelCount ||
    container.levels.length >
      1 +
        Math.floor(
          Math.log2(Math.max(container.pixelWidth, container.pixelHeight)),
        )
  )
    throw new Error("Invalid compressed mip count");
  const dfd = container.dataFormatDescriptor[0];
  if (
    !dfd ||
    dfd.texelBlockDimension[0] !== block.width - 1 ||
    dfd.texelBlockDimension[1] !== block.height - 1 ||
    dfd.bytesPlane[0] !== block.bytes ||
    dfd.flags !== 0
  )
    throw new Error("Invalid compressed data format descriptor");
  const levels = container.levels.map((level, mip) => {
    const width = Math.max(1, Math.floor(container.pixelWidth / 2 ** mip)),
      height = Math.max(1, Math.floor(container.pixelHeight / 2 ** mip));
    const columns = Math.ceil(width / block.width),
      rows = Math.ceil(height / block.height),
      byteLength = columns * rows * block.bytes;
    if (
      level.levelData.byteLength !== byteLength ||
      level.uncompressedByteLength !== byteLength
    )
      throw new Error("Invalid compressed mip byte length");
    return {
      data: level.levelData,
      width: columns * block.width,
      height: rows * block.height,
      bytesPerRow: columns * block.bytes,
      rows,
    };
  });
  return {
    format: (block.format + (srgb ? "-srgb" : "")) as GPUTextureFormat,
    feature: block.feature,
    width: container.pixelWidth,
    height: container.pixelHeight,
    levels,
  };
}
export function uploadCompressed(
  device: GPUDevice,
  resources: Resources,
  data: Omit<ReturnType<typeof compressedTexture>, "feature"> & {
    feature?: GPUFeatureName;
  },
  label: string,
): GPUTexture {
  if (data.feature && !device.features.has(data.feature))
    throw new Error(`Device does not support ${data.feature}`);
  if (Math.max(data.width, data.height) > device.limits.maxTextureDimension2D)
    throw new Error("Compressed texture exceeds device limits");
  const texture = resources.textures.create({
    label,
    size: [data.width, data.height],
    format: data.format,
    mipLevelCount: data.levels.length,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC,
  });
  try {
    for (let mip = 0; mip < data.levels.length; mip++) {
      const level = data.levels[mip]!;
      device.queue.writeTexture(
        { texture, mipLevel: mip },
        level.data,
        { bytesPerRow: level.bytesPerRow, rowsPerImage: level.rows },
        [level.width, level.height],
      );
    }
    return texture;
  } catch (error) {
    resources.textures.destroy(texture);
    throw error;
  }
}
