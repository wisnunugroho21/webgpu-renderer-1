import assert from "node:assert/strict";
import { readRGB, linear } from "./pixel-references.mjs";

/** Validate clustered lighting, shadow projections, cache invalidation and warm resources. */
export function assertLightingReport(report) {
  const rgb = (pixel) => {
    // Normalize presentation channel order before comparing light contributions.
    return readRGB(report.format, pixel);
  };
  const lc = report.lightChecks,
    ambient = rgb(lc.results.ambient.pixel),
    near = rgb(lc.results.near.pixel),
    far = rgb(lc.results.far.pixel),
    red = rgb(lc.results.red.pixel);
  assert.ok(red[0] > ambient[0]);
  assert.equal(red[1], ambient[1]);
  assert.equal(red[2], ambient[2]);
  assert.deepEqual(lc.results.range.pixel, lc.results.ambient.pixel);
  assert.deepEqual(lc.results.spotAway.pixel, lc.results.ambient.pixel);
  assert.deepEqual(lc.results.spot.pixel, lc.results.near.pixel);
  assert.deepEqual(lc.noLights, lc.results.ambient.pixel);
  const ratio =
    (linear(near[2]) - linear(ambient[2])) /
    (linear(far[2]) - linear(ambient[2]));
  assert.ok(Math.abs(ratio - 4) < 0.25, "point light inverse-square falloff");
  assert.equal(lc.bindGroups, 0);
  assert.deepEqual(lc.resourcesBefore, lc.resourcesAfter);
  assert.ok(
    report.clusterChecks.image.maxDifference <= 1,
    "clustered lighting matches brute-force full image",
  );
  assert.equal(report.clusterChecks.metadata.invalidOffsets, 0);
  assert.ok(report.clusterChecks.metadata.meanCandidates < 1024 / 4);
  assert.ok(
    report.clusterChecks.timings.on.completionMedianMs <
      report.clusterChecks.timings.off.completionMedianMs * 0.8,
    "many-light clustering improves completion latency",
  );
  assert.equal(
    report.clusterChecks.overflowImage.maxDifference,
    0,
    "overflow fallback preserves all lights",
  );
  assert.ok(report.clusterChecks.overflowMetadata.overflowClusters > 0);
  assert.deepEqual(
    report.clusterChecks.resourcesBefore,
    report.clusterChecks.resourcesAfter,
  );
  assert.ok(
    report.shadowChecks.litPixel[0] - report.shadowChecks.shadowPixel[0] > 70,
    "directional shadow darkens the receiver",
  );
  assert.deepEqual(
    report.shadowChecks.maskedPixel,
    report.shadowChecks.litPixel,
    "masked geometry discards shadow depth",
  );
  assert.equal(report.shadowChecks.stats.shadowPasses, 1);
  assert.equal(report.shadowChecks.stats.shadowTriangles, 14);
  assert.deepEqual(
    report.shadowChecks.resourcesBefore,
    report.shadowChecks.resourcesAfter,
  );
  assert.equal(
    report.shadowChecks.cullingImage.maxDifference,
    0,
    "shadow culling preserves image",
  );
  assert.equal(report.shadowChecks.culled.shadowRejected, 1);
  assert.equal(
    report.shadowChecks.unculled.shadowTriangles -
      report.shadowChecks.culled.shadowTriangles,
    12,
  );
  assert.ok(
    report.shadowChecks.multipleCasters.lit[0] -
      report.shadowChecks.multipleCasters.shadow[0] >
      70,
  );
  assert.equal(report.shadowChecks.multipleCasters.stats.shadowTriangles, 26);
  assert.equal(report.shadowChecks.multipleLights.stats.shadowPasses, 2);
  assert.deepEqual(report.shadowChecks.multipleLights.ranges, [1, 1, 2, 1]);
  assert.equal(
    report.shadowChecks.deformation.maxDifference,
    0,
    "shadow/color deformation matches static reference",
  );
  assert.notDeepEqual(
    report.shadowChecks.deformedPixel,
    report.shadowChecks.litPixel,
  );
  assert.equal(report.shadowChecks.cascades.stats.shadowPasses, 4);
  assert.equal(report.shadowChecks.cascades.splits[3], 30);
  for (let i = 1; i < 4; i++)
    assert.ok(
      report.shadowChecks.cascades.splits[i] >
        report.shadowChecks.cascades.splits[i - 1],
    );
  assert.ok(
    report.shadowChecks.litPixel[0] - report.shadowChecks.cascades.pixel[0] >
      70,
    "cascade receiver shadows correctly",
  );
  assert.deepEqual(
    report.shadowChecks.cascades.resourcesBefore,
    report.shadowChecks.cascades.resourcesAfter,
  );
  assert.equal(
    report.shadowChecks.cache.stats.shadowPasses,
    0,
    "unchanged shadow maps skip depth passes",
  );
  assert.equal(report.shadowChecks.cache.stats.shadowCacheHits, 4);
  assert.equal(report.shadowChecks.cache.stats.shadowUploadBytes, 0);
  assert.ok(report.shadowChecks.cache.moved.stats.shadowPasses > 0);
  assert.deepEqual(
    report.shadowChecks.cache.moved.pixel,
    report.shadowChecks.litPixel,
    "moving casters invalidates cache",
  );
  assert.ok(report.shadowChecks.cache.materialChanged.stats.shadowPasses > 0);
  assert.deepEqual(
    report.shadowChecks.cache.materialChanged.pixel,
    report.shadowChecks.litPixel,
    "alpha changes invalidate cache",
  );
  assert.deepEqual(
    report.shadowChecks.cache.resourcesBefore,
    report.shadowChecks.cache.resourcesAfter,
  );
}
