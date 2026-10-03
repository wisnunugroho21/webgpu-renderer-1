import assert from "node:assert/strict";
/** Assert correctness and warm resource reuse; timings are observational, not universal thresholds. */
export function assertBenchmarkReport(report, errors) {
  assert.deepEqual(errors, []);
  for (const row of report.materials) {
    assert.equal(
      row.stats.materialSwitches,
      row.mode === "individual" && row.materials > 1 ? 1000 : row.materials,
    );
    assert.equal(row.stats.pipelineSwitches, 1);
    assert.equal(
      row.stats.drawCalls,
      row.mode === "instanced" ? row.materials : 1000,
    );
  }
  for (const row of report.animation) {
    if (row.keyCount === 1024) {
      assert.equal(row.distinctPhases, row.characters);
      assert.equal(row.warmupFrames, 60);
      assert.equal(row.measuredFrames, 60);
      assert.deepEqual(row.sampleImageDifference, {
        differentBytes: 0,
        maxDifference: 0,
      });
    }
    assert.equal(row.stats.activeAnimators, row.characters);
    assert.equal(row.stats.jointCount, row.characters * 64);
    assert.equal(row.stats.instances, row.characters);
    assert.equal(row.stats.jointUploadBytes, row.characters * 4096);
    assert.equal(row.sharedSkeleton, true);
    assert.equal(row.sharedClip, true);
    assert.equal(row.stats.drawCalls, 1);
  }
  for (const row of report.morph) {
    assert.equal(row.stats.instances, 1000);
    assert.equal(row.stats.activeMorphTargets, row.activeTargets * 1000);
    assert.equal(row.stats.morphUploadBytes, row.activeTargets * 4000);
    assert.equal(row.stats.drawCalls, 1);
  }
  assert.equal(report.combined.stats.jointCount, 64000);
  assert.equal(report.combined.stats.activeMorphTargets, 16000);
  for (const row of [
    ...report.materials,
    ...report.animation,
    ...report.morph,
    report.combined,
    ...report.occlusion,
  ]) {
    for (const key of [
      "pipelineCreations",
      "shaderModules",
      "bufferCreations",
      "textureCreations",
      "samplerCreations",
    ])
      assert.equal(row.resourcesBefore[key], row.resourcesAfter[key]);
  }
  if (!report.occlusion[0].unsupported) {
    assert.equal(report.occlusion[0].visibleInstances, 10001);
    assert.equal(report.occlusion[1].visibleInstances, 1);
    assert.equal(report.occlusion[1].imageDifference.maxDifference, 0);
  }

  assert.equal(report.geometry.defaultEnabled, false);
  if (report.geometry.supported) {
    for (const row of [
      ...report.geometry.benchmarks,
      ...report.geometry.checks,
    ]) {
      assert.equal(
        row.imageDifference.maxDifference,
        0,
        `Geometry image mismatch: ${row.workload ?? row.name}`,
      );
      if (row.diagnostic) assert.equal(row.diagnostic.falseInvisible, 0);
      if (row.resourcesBefore)
        for (const key of [
          "pipelineCreations",
          "shaderModules",
          "bufferCreations",
          "textureCreations",
          "samplerCreations",
        ])
          assert.equal(row.resourcesBefore[key], row.resourcesAfter[key]);
    }
    const narrow = report.geometry.benchmarks.find(
        (x) => x.enabled && x.workload === "mostly-outside",
      ),
      full = report.geometry.benchmarks.find(
        (x) => x.enabled && x.workload === "fully-visible",
      );
    assert.ok(narrow.diagnostic.rejected > narrow.diagnostic.candidates / 2);
    assert.equal(full.diagnostic.rejected, 0);
    assert.ok(
      report.geometry.checks.find((x) => x.name === "morph-skin-fallback").stats
        .activeMorphTargets > 0,
    );
    assert.equal(
      report.geometry.checks.find((x) => x.name === "cpu-lod").stats.lod1,
      1,
    );
    assert.ok(
      report.geometry.checks.find((x) => x.name === "shadows").stats
        .shadowDrawCalls > 0,
    );
    assert.equal(
      report.geometry.checks.find((x) => x.name === "culling-disabled")
        .diagnostic.rejected,
      0,
    );
    for (const name of [
      "transparent-fallback",
      "gpu-object-indirect-fallback",
      "morph-skin-fallback",
    ])
      assert.equal(
        report.geometry.checks.find((x) => x.name === name).stats
          .geometryClusterCandidates,
        0,
      );
  }
}
