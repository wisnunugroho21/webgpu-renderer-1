export interface TextureMemory {
  bytes: number;
  mipBytes: number;
  compressedBytes: number;
}
/** Return block geometry for WebGPU formats; depth24plus storage is an estimate, not driver residency. */
function block(format: GPUTextureFormat): [number, number, number] {
  if (format.startsWith("bc"))
    return [4, 4, /^(bc1-|bc4-)/.test(format) ? 8 : 16];
  if (format.startsWith("etc2") || format.startsWith("eac"))
    return [4, 4, /^(etc2-rgba8|eac-rg11)/.test(format) ? 16 : 8];
  const astc = /^astc-(\d+)x(\d+)-/.exec(format);
  if (astc) return [Number(astc[1]), Number(astc[2]), 16];
  const special: Partial<Record<GPUTextureFormat, number>> = {
    stencil8: 1,
    depth16unorm: 2,
    depth24plus: 4,
    "depth24plus-stencil8": 8,
    depth32float: 4,
    "depth32float-stencil8": 8,
    rgb10a2uint: 4,
    rgb10a2unorm: 4,
    rg11b10ufloat: 4,
    rgb9e5ufloat: 4,
  };
  const bytes = special[format];
  if (bytes) return [1, 1, bytes];
  const components = /^(r|rg|rgba|bgra)(8|16|32)/.exec(format);
  if (!components) throw new Error(`Unknown texture memory format: ${format}`);
  return [
    1,
    1,
    ((components[1] === "r" ? 1 : components[1] === "rg" ? 2 : 4) *
      Number(components[2])) /
      8,
  ];
}
/** Sum logical texel/block storage for every mip, array layer, volume slice and MSAA sample.
 * Array layers stay constant across mips; 3D depth shrinks. Small compressed levels round up to full blocks. */
export function textureMemory(descriptor: GPUTextureDescriptor): TextureMemory {
  const size = descriptor.size;
  const values =
    Symbol.iterator in Object(size)
      ? Array.from(size as Iterable<number>)
      : undefined;
  const dict = size as GPUExtent3DDict;
  const width = values?.[0] ?? dict.width;
  const height = values ? (values[1] ?? 1) : (dict.height ?? 1);
  const depth = values ? (values[2] ?? 1) : (dict.depthOrArrayLayers ?? 1);
  const levels = descriptor.mipLevelCount ?? 1,
    samples = descriptor.sampleCount ?? 1;
  for (const v of [width, height, depth, levels, samples])
    if (!Number.isSafeInteger(v) || v < 1)
      throw new Error("Invalid texture memory dimensions");
  const largest =
    descriptor.dimension === "3d"
      ? Math.max(width, height, depth)
      : Math.max(width, height);
  if (levels > 1 + Math.floor(Math.log2(largest)))
    throw new Error("Invalid texture mip count");
  const [bw, bh, blockBytes] = block(descriptor.format);
  let bytes = 0,
    base = 0;
  for (let mip = 0; mip < levels; mip++) {
    const scale = 2 ** mip;
    const w = Math.max(1, Math.floor(width / scale));
    const h = Math.max(1, Math.floor(height / scale));
    const d =
      descriptor.dimension === "3d"
        ? Math.max(1, Math.floor(depth / scale))
        : depth;
    const level =
      Math.ceil(w / bw) * Math.ceil(h / bh) * d * blockBytes * samples;
    if (!mip) base = level;
    bytes += level;
  }
  if (!Number.isSafeInteger(bytes))
    throw new Error("Texture memory size overflow");
  return { bytes, mipBytes: bytes - base, compressedBytes: bw > 1 ? bytes : 0 };
}
