import { it, expect } from "vitest";
import {
  createDefaultContainer,
  VKFormat,
  write,
  VK_FORMAT_BC1_RGBA_UNORM_BLOCK,
  VK_FORMAT_ASTC_4x4_UNORM_BLOCK,
  VK_FORMAT_ETC2_R8G8B8A8_UNORM_BLOCK,
} from "ktx-parse";
import { compressedTexture } from "../src/assets/textures/CompressedTexture";
/** Builds controlled test dependencies and reusable state for compressed-textures. */
function fixture(format: VKFormat = VK_FORMAT_BC1_RGBA_UNORM_BLOCK, bytes = 8) {
  const c = createDefaultContainer();
  c.vkFormat = format;
  c.typeSize = 1;
  c.pixelWidth = c.pixelHeight = 8;
  c.levelCount = 4;
  c.dataFormatDescriptor[0]!.texelBlockDimension = [3, 3, 0, 0];
  c.dataFormatDescriptor[0]!.bytesPlane = [bytes, 0, 0, 0, 0, 0, 0, 0];
  c.levels = [4, 1, 1, 1].map(
    (
      blocks,
    ) => /** Builds a record containing level data, uncompressed byte length. */ ({
      levelData: new Uint8Array(blocks * bytes),
      uncompressedByteLength: blocks * bytes,
    }),
  );
  return c;
}
it("validates native BC/ETC2/ASTC mip layout and role color space", () => {
  // Verifies validates native BC/ETC2/ASTC mip layout and role color space.

  const c = fixture(),
    input = write(c),
    data = compressedTexture(input, true);
  expect(data.format).toBe("bc1-rgba-unorm-srgb");
  expect(
    data.levels.map((l) => /** Returns l data length. */ l.data.length),
  ).toEqual([32, 8, 8, 8]);
  expect(
    data.levels.map(
      (l) => /** Returns the ordered values needed by this operation. */ [
        l.width,
        l.height,
      ],
    ),
  ).toEqual([
    [8, 8],
    [4, 4],
    [4, 4],
    [4, 4],
  ]);
  expect(data.levels[0]!.data.buffer).toBe(input.buffer);
  expect(
    compressedTexture(write(fixture(VK_FORMAT_ASTC_4x4_UNORM_BLOCK, 16)), false)
      .feature,
  ).toBe("texture-compression-astc");
  expect(
    compressedTexture(
      write(fixture(VK_FORMAT_ETC2_R8G8B8A8_UNORM_BLOCK, 16)),
      false,
    ).feature,
  ).toBe("texture-compression-etc2");
});
it("rejects malformed, nonnative, unaligned, and layered assets before GPU allocation", () => {
  // Verifies rejects malformed, nonnative, unaligned, and layered assets before GPU allocation.

  expect(() =>
    /** Delegates this operation to compressedTexture. */ compressedTexture(
      new Uint8Array(80),
      false,
    ),
  ).toThrow();
  const c = fixture(),
    valid = write(c);
  const bad = valid.slice();
  new DataView(bad.buffer).setBigUint64(88, 31n, true);
  expect(() =>
    /** Delegates this operation to compressedTexture. */ compressedTexture(
      bad,
      false,
    ),
  ).toThrow("byte length");
  const unaligned = valid.slice();
  new DataView(unaligned.buffer).setUint32(20, 7, true);
  expect(() =>
    /** Delegates this operation to compressedTexture. */ compressedTexture(
      unaligned,
      false,
    ),
  ).toThrow("align");
  const layered = valid.slice();
  new DataView(layered.buffer).setUint32(32, 2, true);
  expect(() =>
    /** Delegates this operation to compressedTexture. */ compressedTexture(
      layered,
      false,
    ),
  ).toThrow("2D");
  const basis = valid.slice();
  new DataView(basis.buffer).setUint32(12, 0, true);
  expect(() =>
    /** Delegates this operation to compressedTexture. */ compressedTexture(
      basis,
      false,
    ),
  ).toThrow("transcode");
});
