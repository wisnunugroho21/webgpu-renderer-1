import { describe, it, expect } from "vitest";
import { DataTexture, FloatType, RGBAFormat } from "three";
import { EXRExporter } from "three/addons/exporters/EXRExporter.js";
import {
  decodeEnvironmentPanorama,
  EnvironmentLoader,
} from "../src/rendering/environment/EnvironmentLoader";
function hdr(top = [128, 0, 0, 129], bottom = [0, 128, 0, 129]): Uint8Array {
  const header = new TextEncoder().encode(
    "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n",
  );
  return new Uint8Array([...header, ...top, ...top, ...bottom, ...bottom]);
}
describe("cold HDR/EXR panorama loading", () => {
  it("preserves radiance and top-down rows using an independent RGBE reference", async () => {
    const data = await decodeEnvironmentPanorama(hdr());
    expect(data.width).toBe(2);
    expect(data.height).toBe(2);
    expect(data.pixels[0]).toBeCloseTo(1, 6);
    expect(data.pixels[1]).toBe(0);
    expect(data.pixels[6]).toBe(0);
    expect(data.pixels[7]).toBeCloseTo(1, 6);
  });
  it("decodes independently encoded EXR float scanlines with correct row orientation", async () => {
    const pixels = new Float32Array([
      0, 4, 0, 1, 0, 4, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1,
    ]);
    // DataTexture/EXRExporter input is bottom-up: green bottom, red top.
    const texture = new DataTexture(pixels, 2, 2, RGBAFormat, FloatType);
    const bytes = await new EXRExporter().parse(texture, {
      type: FloatType,
      compression: 0,
    });
    const result = await decodeEnvironmentPanorama(bytes);
    expect(result.pixels).toEqual(
      new Float32Array([2, 0, 0, 2, 0, 0, 0, 4, 0, 0, 4, 0]),
    );
  });
  it("deduplicates content/options, evicts LRU bakes, and never caches failures", async () => {
    const loader = new EnvironmentLoader(1, 1024 * 1024),
      options = { specularSize: 2, diffuseSize: 1, brdfSize: 2, samples: 8 };
    const [a, b] = await Promise.all([
      loader.decode(hdr(), options),
      loader.decode(hdr(), options),
    ]);
    expect(a).toBe(b);
    expect(loader.metrics.bakes).toBe(1);
    expect(await loader.decode(hdr(), options)).toBe(a);
    await loader.decode(hdr([0, 0, 128, 129]), options);
    expect(loader.size).toBe(1);
    expect(await loader.decode(hdr(), options)).not.toBe(a);
    expect(loader.metrics.bakes).toBe(3);
    await expect(
      loader.decode(new Uint8Array([1, 2, 3]), options),
    ).rejects.toThrow();
    expect(loader.size).toBe(1);
    loader.clear();
    expect(loader.cachedBytes).toBe(0);
    await expect(
      loader.decode(hdr(), options, AbortSignal.abort()),
    ).rejects.toThrow();
  });
});
