import assert from "node:assert/strict";
import { clearPixel, readRGB, linear, srgb } from "./pixel-references.mjs";

/** Validate presentation, material coverage, PBR maps and mip references. */
export function assertSurfaceReport(report, pageErrors) {
  assert.ok(
    Number.isFinite(report.frameCadence.fps) && report.frameCadence.fps > 0,
  );
  assert.ok(
    Number.isFinite(report.frameCadence.frameTimeMs) &&
      report.frameCadence.frameTimeMs > 0,
  );
  assert.ok(
    Number.isFinite(report.frameCadence.cpuFrameMs) &&
      report.frameCadence.cpuFrameMs >= 0,
  );
  assert.equal(report.validationError, null);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(pageErrors, []);
  const expected = clearPixel(report.format);
  report.pixel.forEach((value, i) =>
    /** Delegates this operation to assert.ok. */ assert.ok(
      Math.abs(value - expected[i]) <= 1,
      `clear pixel channel ${i}: ${value}`,
    ),
  );
  const rgb = (pixel) => {
    // Normalize presentation channel order before checking material colors.
    return readRGB(report.format, pixel);
  };
  const center = rgb(report.centerPixel),
    tint = rgb(report.materialChecks.tint);
  assert.ok(
    center[2] > center[1] && center[1] > center[0],
    "PBR blue face preserves vertex color ordering",
  );
  assert.ok(
    tint[1] < center[1] / 2 && Math.abs(tint[2] - center[2]) <= 1,
    "base color modulates diffuse; dielectric specular remains",
  );
  assert.deepEqual(report.materialChecks.mask, expected);
  assert.deepEqual(report.materialChecks.offscreen, expected);
  assert.equal(report.materialChecks.offscreenStats.frustumRejected, 1);
  assert.equal(report.materialChecks.offscreenStats.drawCalls, 0);
  const asset = rgb(report.assetPixel);
  assert.ok(
    asset[2] > asset[0] && asset[0] > asset[1],
    "glTF metallic color ordering",
  );
  const blendExpected = report.centerPixel.map((v, i) =>
    /** Selects the result according to i === 3. */ i === 3
      ? 255
      : srgb((linear(v) + linear(expected[i])) / 2),
  );
  report.materialChecks.blend.forEach((v, i) =>
    /** Delegates this operation to assert.ok. */ assert.ok(
      Math.abs(v - blendExpected[i]) <= 2,
      "alpha blends in linear space",
    ),
  );
  const pbr = report.pbrChecks;
  rgb(pbr.emissive).forEach((v, i) =>
    /** Delegates this operation to assert.ok. */ assert.ok(
      Math.abs(v - [128, 64, 32][i]) <= 1,
      "sRGB emissive roundtrip",
    ),
  );
  rgb(pbr.uv1).forEach((v, i) =>
    /** Delegates this operation to assert.ok. */ assert.ok(
      Math.abs(v - [32, 128, 64][i]) <= 1,
      "TEXCOORD_1 selects second emissive texel",
    ),
  );
  assert.notDeepEqual(pbr.normal, pbr.flat, "normal map changes lighting");
  assert.notDeepEqual(pbr.metal, pbr.flat, "metallic factor changes BRDF");
  assert.notDeepEqual(pbr.smooth, pbr.flat, "roughness factor changes BRDF");
  assert.ok(
    rgb(pbr.ao).every(
      (v, i) =>
        /** Evaluates the v < rgb(pbr.flat)[i] condition. */ v <
        rgb(pbr.flat)[i],
    ),
    "AO reduces indirect illumination",
  );
  assert.deepEqual(pbr.culled, expected, "single-sided back face is culled");
  rgb(pbr.doubleSided).forEach((v, i) =>
    /** Delegates this operation to assert.ok. */ assert.ok(
      Math.abs(v - [128, 64, 32][i]) <= 1,
      "double-sided back face renders",
    ),
  );
  assert.equal(
    report.textureChecks.misses,
    2,
    "content plus color space distinguishes two textures",
  );
  assert.equal(
    report.textureChecks.decodes,
    1,
    "one image decode serves two formats",
  );
  assert.equal(
    report.textureChecks.creations,
    2,
    "cross-role/concurrent deduplication",
  );
  assert.equal(
    report.textureChecks.samplerCreations,
    0,
    "cached samplers reused throughout texture loading",
  );
  assert.equal(report.textureChecks.warmDecodes, 0);
  assert.equal(report.textureChecks.warmMisses, 0);
  for (const [format, expected] of [
    ["rgba8unorm", 85],
    ["rgba8unorm-srgb", 156],
  ]) {
    const mip = report.textureChecks.mips[format];
    assert.equal(mip.levels, 3);
    mip.pixel
      .slice(0, 3)
      .forEach((v) =>
        /** Delegates this operation to assert.ok. */ assert.ok(
          Math.abs(v - expected) <= 1,
          "odd-sized mip averages in correct color space",
        ),
      );
    assert.equal(mip.pixel[3], 255);
  }
}
