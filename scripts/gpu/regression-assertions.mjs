import assert from "node:assert/strict";
/** Assert correctness and warm resource reuse; timings are observational, not universal thresholds. */
export function assertRegressionReport(
  report,
  pageErrors,
  workerChecks,
  loadingChecks,
) {
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
  const expected = report.format.startsWith("bgra")
    ? [36, 20, 10, 255]
    : [10, 20, 36, 255];
  report.pixel.forEach((value, i) =>
    assert.ok(
      Math.abs(value - expected[i]) <= 1,
      `clear pixel channel ${i}: ${value}`,
    ),
  );
  const rgb = (pixel) =>
    report.format.startsWith("bgra")
      ? [pixel[2], pixel[1], pixel[0]]
      : pixel.slice(0, 3);
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
  const linear = (byte) =>
    byte / 255 <= 0.04045
      ? byte / 255 / 12.92
      : ((byte / 255 + 0.055) / 1.055) ** 2.4;
  const srgb = (value) =>
    Math.round(
      255 *
        (value <= 0.0031308
          ? value * 12.92
          : 1.055 * value ** (1 / 2.4) - 0.055),
    );
  const blendExpected = report.centerPixel.map((v, i) =>
    i === 3 ? 255 : srgb((linear(v) + linear(expected[i])) / 2),
  );
  report.materialChecks.blend.forEach((v, i) =>
    assert.ok(
      Math.abs(v - blendExpected[i]) <= 2,
      "alpha blends in linear space",
    ),
  );
  const pbr = report.pbrChecks;
  rgb(pbr.emissive).forEach((v, i) =>
    assert.ok(Math.abs(v - [128, 64, 32][i]) <= 1, "sRGB emissive roundtrip"),
  );
  rgb(pbr.uv1).forEach((v, i) =>
    assert.ok(
      Math.abs(v - [32, 128, 64][i]) <= 1,
      "TEXCOORD_1 selects second emissive texel",
    ),
  );
  assert.notDeepEqual(pbr.normal, pbr.flat, "normal map changes lighting");
  assert.notDeepEqual(pbr.metal, pbr.flat, "metallic factor changes BRDF");
  assert.notDeepEqual(pbr.smooth, pbr.flat, "roughness factor changes BRDF");
  assert.ok(
    rgb(pbr.ao).every((v, i) => v < rgb(pbr.flat)[i]),
    "AO reduces indirect illumination",
  );
  assert.deepEqual(pbr.culled, expected, "single-sided back face is culled");
  rgb(pbr.doubleSided).forEach((v, i) =>
    assert.ok(
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
        assert.ok(
          Math.abs(v - expected) <= 1,
          "odd-sized mip averages in correct color space",
        ),
      );
    assert.equal(mip.pixel[3], 255);
  }
  assert.equal(report.animationChecks.time, 0.5);
  assert.equal(report.animationChecks.position, 5);
  assert.equal(report.animationChecks.scale, 0.75);
  report.animationChecks.rotation.forEach((v) =>
    assert.ok(Math.abs(v - Math.SQRT1_2) < 1e-6),
  );
  assert.deepEqual(report.animationChecks.weights, [0.5]);
  assert.equal(
    report.animationChecks.renderMorphId,
    report.animationChecks.morphId,
  );
  assert.equal(report.animationChecks.endTime, 1);
  assert.equal(report.animationChecks.playing, false);
  assert.equal(
    report.animationChecks.drawCalls,
    0,
    "animated translation propagates to culling",
  );
  assert.equal(report.skinChecks.instances, 2);
  assert.ok(
    report.skinChecks.sharedAsset && report.skinChecks.independentMatrices,
  );
  assert.equal(report.skinChecks.jointCount, 2);
  assert.deepEqual(report.skinChecks.parents, [-1, 0]);
  assert.equal(new Set(report.skinChecks.renderIds).size, 2);
  report.skinChecks.renderIds.forEach((id) => assert.ok(id >= 0));
  assert.ok(Math.abs(report.skinChecks.weights[0] - 128 / 255) < 1e-6);
  assert.ok(Math.abs(report.skinChecks.weights[1] - 127 / 255) < 1e-6);
  assert.equal(report.skinChecks.changed, 4);
  assert.equal(report.skinChecks.unchanged, 0);
  const matrixX = report.skinChecks.initialMatrices.map((m) => m[12]);
  assert.ok(
    matrixX.includes(0) && matrixX.includes(-4),
    "each palette uses its mesh world inverse",
  );
  assert.equal(report.jointChecks.full.activeSkeletons, 2);
  assert.equal(report.jointChecks.full.jointCount, 4);
  assert.equal(report.jointChecks.full.updatedJoints, 4);
  assert.equal(report.jointChecks.full.jointUploadBytes, 256);
  assert.equal(report.jointChecks.unchanged.jointUploadBytes, 0);
  assert.equal(report.jointChecks.partial.updatedJoints, 2);
  assert.equal(report.jointChecks.partial.jointUploadBytes, 128);
  assert.equal(report.jointChecks.writes, 2);
  assert.deepEqual(report.jointChecks.offsets, [0, 2]);
  assert.deepEqual(
    report.jointChecks.gpuJointX,
    report.skinChecks.initialMatrices.map((m) => m[12]),
    "GPU palettes match CPU instance order",
  );
  assert.deepEqual(
    report.jointChecks.resourcesBefore,
    report.jointChecks.resourcesAfter,
  );
  report.gpuSkinChecks.skinPixel.forEach((v, i) =>
    assert.ok(
      Math.abs(v - report.gpuSkinChecks.referencePixel[i]) <= 1,
      "GPU-skinned position/normal/tangent matches static reference",
    ),
  );
  assert.notDeepEqual(report.gpuSkinChecks.skinPixel, expected);
  assert.deepEqual(report.gpuSkinChecks.movedPixel, expected);
  assert.equal(
    report.gpuSkinChecks.vertexWrites,
    0,
    "animation never rewrites vertex buffers",
  );
  assert.equal(report.gpuSkinChecks.stats.instances, 1000);
  assert.equal(report.gpuSkinChecks.stats.drawCalls, 1);
  assert.deepEqual(
    report.gpuSkinChecks.resourcesBefore,
    report.gpuSkinChecks.resourcesAfter,
  );
  assert.equal(new Set(report.morphChecks.states.map((s) => s.offset)).size, 2);
  report.morphChecks.states.forEach((s) => {
    assert.ok(s.shared);
    assert.equal(s.count, 1);
  });
  const defaults = report.morphChecks.states.map((s) => s.weights[0]).sort();
  assert.ok(
    Math.abs(defaults[0] - 0.1) < 1e-6 && Math.abs(defaults[1] - 0.2) < 1e-6,
    "node override and mesh defaults",
  );
  report.morphChecks.targets.forEach((t) => {
    assert.equal(t.count, 1);
    assert.equal(t.vertices, 3);
    assert.deepEqual(t.position, [0, 0, 1]);
  });
  assert.deepEqual(report.morphBufferChecks.position, [0, 0, 1, 0]);
  assert.deepEqual(report.morphBufferChecks.normal, [0, 0, 0, 0]);
  assert.deepEqual(report.morphBufferChecks.tangent, [0, 0, 0, 0]);
  assert.ok(
    Math.abs(
      report.morphBufferChecks.weight - report.morphBufferChecks.expectedWeight,
    ) < 1e-6,
  );
  assert.equal(report.morphBufferChecks.changedBytes, 4);
  assert.equal(report.morphBufferChecks.unchangedBytes, 0);
  report.gpuMorphChecks.morphedPixel.forEach((v, i) =>
    assert.ok(
      Math.abs(v - report.gpuMorphChecks.referencePixel[i]) <= 1,
      "GPU position/normal/tangent morphing matches weighted static reference",
    ),
  );
  assert.notDeepEqual(report.gpuMorphChecks.morphedPixel, expected);
  assert.deepEqual(report.gpuMorphChecks.movedPixel, expected);
  assert.equal(report.gpuMorphChecks.vertexWrites, 0);
  assert.equal(report.gpuMorphChecks.stats.instances, 1000);
  assert.equal(report.gpuMorphChecks.stats.drawCalls, 1);
  assert.equal(report.gpuMorphChecks.stats.morphUploadBytes, 0);
  assert.deepEqual(
    report.gpuMorphChecks.resourcesBefore,
    report.gpuMorphChecks.resourcesAfter,
  );
  report.combinedChecks.pixel.forEach((v, i) =>
    assert.ok(
      Math.abs(v - report.combinedChecks.reference[i]) <= 1,
      "morph-before-skin matches static reference",
    ),
  );
  assert.notDeepEqual(report.combinedChecks.pixel, expected);
  assert.deepEqual(
    report.combinedChecks.depthPixel,
    report.combinedChecks.pixel,
    "deformed depth prepass retains color output",
  );
  assert.equal(report.combinedChecks.stats.instances, 1000);
  assert.equal(report.combinedChecks.stats.drawCalls, 1);
  assert.deepEqual(
    report.combinedChecks.resourcesBefore,
    report.combinedChecks.resourcesAfter,
  );
  assert.deepEqual(
    report.boundsChecks.results.none.pixel,
    report.boundsChecks.results.linear.pixel,
  );
  assert.deepEqual(
    report.boundsChecks.results.none.pixel,
    report.boundsChecks.results.bvh.pixel,
  );
  assert.notDeepEqual(report.boundsChecks.results.none.pixel, expected);
  for (const result of Object.values(report.boundsChecks.results))
    assert.equal(
      result.stats.visibleObjects,
      2,
      "animated visible geometry survives culling",
    );
  assert.deepEqual(report.boundsChecks.offscreen.pixel, expected);
  assert.equal(report.boundsChecks.offscreen.stats.drawCalls, 0);
  assert.equal(report.boundsChecks.offscreen.stats.frustumRejected, 2);
  assert.equal(report.boundsChecks.jointBoxes, 4);
  assert.equal(report.blendingChecks.position, -2.5);
  assert.equal(report.blendingChecks.scale, 0.5);
  assert.ok(
    Math.abs(report.blendingChecks.rotation - Math.sin(Math.PI / 8)) < 1e-6,
  );
  assert.equal(report.blendingChecks.weight, 0.75);
  assert.equal(report.blendingChecks.crossfading, true);
  assert.deepEqual(
    report.lodChecks.results.map((r) => r.selection),
    [0, 1, 2, -1],
  );
  assert.deepEqual(
    report.lodChecks.results.map((r) => r.stats.triangles),
    [12, 8, 1, 0],
  );
  assert.equal(report.lodChecks.results[3].stats.lodCulled, 1);
  assert.deepEqual(
    report.lodChecks.resourcesBefore,
    report.lodChecks.resourcesAfter,
  );
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
  assert.deepEqual(
    report.graphOrder.map((p) => p.name),
    [
      "gpu-frustum",
      "shadows",
      "light-clusters",
      "depth",
      "geometry-clusters",
      "hiz",
      "gpu-occlusion",
      "gpu-lod",
      "gpu-compaction",
      "gpu-indirect",
      "color",
      "hiz-debug",
    ],
  );
  assert.ok(report.profilingChecks.cpuFrames >= 150);
  assert.equal(report.profilingChecks.cpuStages.length, 9);
  report.profilingChecks.cpuStages.forEach((ms) =>
    assert.ok(Number.isFinite(ms) && ms >= 0),
  );
  if (report.profilingChecks.supported) {
    assert.equal(report.profilingChecks.droppedCaptures, 1);
    assert.equal(report.profilingChecks.gpuTimings.length, 18);
    for (const sample of report.profilingChecks.gpuTimings)
      assert.ok(
        Number.isFinite(sample.milliseconds) && sample.milliseconds >= 0,
      );
    assert.deepEqual(
      [...new Set(report.profilingChecks.gpuTimings.map((t) => t.pass))].sort(),
      [0, 1, 2],
    );
  }
  assert.deepEqual(
    report.profilingChecks.resourcesBefore,
    report.profilingChecks.resourcesAfter,
  );
  for (const result of Object.values(report.depthChecks.results)) {
    assert.equal(result.image.maxDifference, 0, "prepass preserves full image");
    assert.equal(result.off.stats.depthPasses, 0);
    assert.equal(result.on.stats.depthPasses, 1);
    assert.equal(result.on.stats.depthDrawCalls, 1);
  }
  assert.equal(
    report.depthChecks.alpha.maxDifference,
    0,
    "prepass retains MASK and BLEND semantics",
  );
  assert.deepEqual(
    report.depthChecks.resourcesBefore,
    report.depthChecks.resourcesAfter,
  );
  assert.equal(report.hizChecks.main.maxError, 0);
  assert.ok(report.hizChecks.main.checked > 300000);
  assert.deepEqual(report.hizChecks.main.top, [1]);
  assert.equal(report.hizChecks.odd.maxError, 0);
  assert.deepEqual(report.hizChecks.odd.levels, [
    [5, 3],
    [2, 1],
    [1, 1],
  ]);
  assert.ok(Math.abs(report.hizChecks.odd.top[0] - 0.36) < 1e-6);
  assert.ok(Math.abs(report.hizChecks.odd.mip1[0] - 0.26) < 1e-6);
  assert.deepEqual(report.hizChecks.debugPixel, [255, 255, 255, 255]);
  assert.deepEqual(
    report.hizChecks.resourcesBefore,
    report.hizChecks.resourcesAfter,
  );
  assert.equal(report.gpuVisibilityChecks.local.mismatches, 0);
  assert.equal(report.gpuVisibilityChecks.large.mismatches, 0);
  assert.equal(report.gpuVisibilityChecks.large.count, 100000);
  assert.ok(
    report.gpuVisibilityChecks.large.visible > 0 &&
      report.gpuVisibilityChecks.large.visible < 100000,
  );
  assert.equal(report.gpuVisibilityChecks.unchangedUploadBytes, 0);
  assert.equal(report.gpuVisibilityChecks.initialUploadBytes, 100000 * 32 + 16);
  assert.deepEqual(report.gpuVisibilityChecks.boundary, [1, 1, 1, 0, 0]);
  assert.deepEqual(
    report.gpuVisibilityChecks.resourcesBefore,
    report.gpuVisibilityChecks.resourcesAfter,
  );
  assert.deepEqual(
    report.gpuVisibilityChecks.large.resourcesBefore,
    report.gpuVisibilityChecks.large.resourcesAfter,
  );
  assert.deepEqual(report.occlusionChecks.live.flags, [1, 0, 1]);
  assert.deepEqual(report.occlusionChecks.boundary, [0, 1, 1, 1, 0, 1]);
  assert.equal(report.occlusionChecks.large.falseInvisible, 0);
  assert.equal(report.occlusionChecks.large.mismatches, 0);
  assert.ok(
    report.occlusionChecks.large.occluded > 0 &&
      report.occlusionChecks.large.occluded < 100000,
  );
  assert.deepEqual(
    report.occlusionChecks.large.resourcesBefore,
    report.occlusionChecks.large.resourcesAfter,
  );
  assert.deepEqual(report.compactionChecks.local, {
    count: 2,
    overflow: 0,
    ids: [0, 2],
  });
  assert.equal(report.compactionChecks.sparse.mismatches, 0);
  assert.equal(
    report.compactionChecks.sparse.unique,
    report.compactionChecks.sparse.count,
  );
  assert.equal(report.compactionChecks.sparse.overflow, 0);
  assert.deepEqual(report.compactionChecks.all, {
    count: 100000,
    overflow: 0,
    unique: 100000,
    minimum: 0,
    maximum: 99999,
  });
  assert.deepEqual(report.compactionChecks.empty, { count: 0, overflow: 0 });
  assert.deepEqual(
    report.compactionChecks.resourcesBefore,
    report.compactionChecks.resourcesAfter,
  );
  if (report.indirectChecks.supported) {
    assert.deepEqual(
      report.combinedChecks.indirectPixel,
      report.combinedChecks.pixel,
      "indirect preserves shared deformation",
    );
    for (const scenario of Object.values(report.indirectChecks.scenarios)) {
      assert.equal(scenario.image.maxDifference, 0);
      assert.ok(scenario.stats.indirectDraws > 0);
      assert.equal(scenario.stats.instances, -1);
    }
    assert.equal(
      report.indirectChecks.scenarios.frustum.args.reduce(
        (sum, a) => sum + a[1],
        0,
      ),
      3,
    );
    assert.equal(
      report.indirectChecks.scenarios.occlusion.args.reduce(
        (sum, a) => sum + a[1],
        0,
      ),
      2,
    );
    assert.equal(
      report.indirectChecks.alpha.image.maxDifference,
      0,
      "indirect preserves alpha order",
    );
    assert.equal(
      report.indirectChecks.cubesImage.maxDifference,
      0,
      "GPU indirect matches 10,000-cube image",
    );
    assert.equal(
      report.indirectChecks.timings["gpu-indirect"].stats.indirectDraws,
      1,
    );
    assert.equal(
      report.indirectChecks.timings["gpu-indirect"].stats.frustumTested,
      0,
    );
    assert.equal(
      report.indirectChecks.timings["gpu-indirect"].stats.indirectUploadBytes,
      0,
    );
    assert.equal(
      report.indirectChecks.offscreenArgs.reduce((sum, a) => sum + a[1], 0),
      0,
    );
    assert.deepEqual(
      report.indirectChecks.resourcesBefore,
      report.indirectChecks.resourcesAfter,
    );
  }
  if (report.indirectChecks.supported) {
    assert.deepEqual(
      report.gpuLODChecks.results.map((r) => r.level),
      [0, 1, 2, -1],
    );
    assert.deepEqual(
      report.gpuLODChecks.results.map((r) =>
        r.args.reduce((sum, a) => sum + (a[0] * a[1]) / 3, 0),
      ),
      [12, 8, 1, 0],
    );
    report.gpuLODChecks.results.forEach((r) =>
      assert.equal(r.image.maxDifference, 0, "GPU LOD matches CPU rendering"),
    );
    assert.deepEqual(report.gpuLODChecks.hysteresis, [0, 0, 1, 1, 0]);
    assert.deepEqual(
      report.gpuLODChecks.resourcesBefore,
      report.gpuLODChecks.resourcesAfter,
    );
  }
  if (report.compressedChecks.supported) {
    assert.equal(report.compressedChecks.format, "bc1-rgba-unorm-srgb");
    assert.equal(report.compressedChecks.mips, 4);
    assert.equal(report.compressedChecks.image.maxDifference, 0);
    for (const block of report.compressedChecks.mipBlocks)
      assert.deepEqual(block, [0, 248, 0, 248, 0, 0, 0, 0]);
  }
  assert.deepEqual(report.streamedMaskChecks.beforeFlags, [1, 0]);
  assert.equal(report.streamedMaskChecks.beforeReuse, true);
  assert.deepEqual(report.streamedMaskChecks.afterFlags, [1, 1]);
  assert.equal(report.streamedMaskChecks.materialReset, true);
  assert.ok(report.streamedMaskChecks.sceneChanged.differingBytes > 0);
  assert.equal(report.streamedMaskChecks.image.maxDifference, 0);
  assert.equal(report.visibilityMatrix.gpuFrustum.mismatches, 0);
  assert.equal(report.visibilityMatrix.gpuHiZ.mismatches, 0);
  assert.equal(
    report.visibilityMatrix.cpuFrustum.visible,
    report.visibilityMatrix.gpuFrustum.visible,
  );
  assert.equal(workerChecks.vertices, 100000);
  assert.equal(workerChecks.mismatches, 0);
  assert.equal(workerChecks.inputDetached, true);
  assert.ok(workerChecks.framesDuringWorker >= 1);
  assert.equal(workerChecks.metrics.workerJobs, 4);
  assert.ok(workerChecks.metrics.transferredInputBytes >= 1000000);
  assert.ok(workerChecks.metrics.transferredOutputBytes >= 1000000);
  assert.equal(report.streamingChecks.lod.indexCount, 3);
  assert.equal(report.streamingChecks.lod.references, 1);
  assert.equal(report.streamingChecks.lod.protectedEvictions, 0);
  assert.equal(report.streamingChecks.lodEvictions, 1);
  assert.equal(report.streamingChecks.evictedMeshUnavailable, true);
  assert.equal(report.streamingChecks.lodRestored.maxDifference, 0);
  assert.equal(report.streamingChecks.textureRestored.maxDifference, 0);
  assert.ok(report.streamingChecks.textureDifference.differingBytes > 0);
  assert.equal(report.streamingChecks.sharedReferences, 1);
  assert.equal(report.streamingChecks.sharedProtectedEvictions, 0);
  assert.equal(report.streamingChecks.textureEvictions, 1);
  assert.equal(
    report.streamingChecks.resourcesBefore.buffers,
    report.streamingChecks.resourcesAfter.buffers,
  );
  assert.equal(
    report.streamingChecks.resourcesBefore.textures,
    report.streamingChecks.resourcesAfter.textures,
  );
  assert.equal(loadingChecks.loadingState, "Loading");
  assert.deepEqual(loadingChecks.history, [
    "Unloaded",
    "Loading",
    "Decoded",
    "Uploading",
    "Ready",
  ]);
  assert.ok(loadingChecks.framesDuringLoad >= 3);
  assert.deepEqual(loadingChecks.loaded, loadingChecks.cached);
  assert.deepEqual(report.temporalChecks.firstFlags, [1, 1]);
  assert.deepEqual(report.temporalChecks.freshFlags, [1, 0]);
  assert.deepEqual(report.temporalChecks.stableFlags, [1, 0]);
  assert.equal(report.temporalChecks.firstImage.maxDifference, 0);
  assert.equal(report.temporalChecks.stableImage.maxDifference, 0);
  assert.equal(report.temporalChecks.reused, true);
  assert.equal(report.temporalChecks.dispatches, 0);
  assert.equal(report.temporalChecks.spawn.newObjects, true);
  assert.deepEqual(report.temporalChecks.spawn.flags, [1, 1, 1]);
  assert.equal(report.temporalChecks.spawn.reuse, false);
  assert.equal(report.temporalChecks.cameraReset, true);
  assert.equal(report.temporalChecks.rotationReset, true);
  assert.equal(report.temporalChecks.motionReset, true);
  assert.deepEqual(
    report.temporalChecks.resourcesBefore,
    report.temporalChecks.resourcesAfter,
  );
  assert.equal(report.gpuLODChecks.large.mismatches, 0);
  if (report.indirectChecks.supported) {
    assert.equal(report.gpuLODChecks.morph.image.maxDifference, 0);
    assert.equal(report.gpuLODChecks.morph.level, 1);
    assert.equal(report.gpuLODChecks.morph.baseVertices, 4);
    assert.equal(report.gpuLODChecks.morph.selectedVertices, 3);
    assert.equal(report.gpuLODChecks.conservativeDepth.image.maxDifference, 0);
    assert.equal(report.gpuLODChecks.conservativeDepth.stats.depthTriangles, 0);
    assert.equal(report.gpuLODChecks.alpha.image.maxDifference, 0);
    assert.deepEqual(report.gpuLODChecks.alpha.levels, [0, 1]);
  }
  assert.ok(report.lossHandled, "device loss callback must update UI");
}
