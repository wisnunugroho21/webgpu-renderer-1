import assert from "node:assert/strict";

/** Validate graph order, profiling, prepass, Hi-Z, compaction and indirect GPU selection. */
export function assertVisibilityReport(report) {
  assert.deepEqual(
    report.graphOrder.map((p) => /** Returns p name. */ p.name),
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
      "motion",
      "transmission-capture",
      "particles",
      "temporal-resolve",
      "post-processing",
      "tone-mapping",
      "hiz-debug",
    ],
  );
  assert.ok(report.profilingChecks.cpuFrames >= 150);
  assert.equal(report.profilingChecks.cpuStages.length, 9);
  report.profilingChecks.cpuStages.forEach((ms) =>
    /** Delegates this operation to assert.ok. */ assert.ok(
      Number.isFinite(ms) && ms >= 0,
    ),
  );
  if (report.profilingChecks.supported) {
    assert.equal(report.profilingChecks.droppedCaptures, 1);
    assert.equal(report.profilingChecks.gpuTimings.length, 18);
    for (const sample of report.profilingChecks.gpuTimings)
      assert.ok(
        Number.isFinite(sample.milliseconds) && sample.milliseconds >= 0,
      );
    assert.deepEqual(
      [
        ...new Set(
          report.profilingChecks.gpuTimings.map(
            (t) => /** Returns t pass. */ t.pass,
          ),
        ),
      ].sort(),
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
        (sum, a) => /** Computes the sum + a[1] result. */ sum + a[1],
        0,
      ),
      3,
    );
    assert.equal(
      report.indirectChecks.scenarios.occlusion.args.reduce(
        (sum, a) => /** Computes the sum + a[1] result. */ sum + a[1],
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
      report.indirectChecks.offscreenArgs.reduce(
        (sum, a) => /** Computes the sum + a[1] result. */ sum + a[1],
        0,
      ),
      0,
    );
    assert.deepEqual(
      report.indirectChecks.resourcesBefore,
      report.indirectChecks.resourcesAfter,
    );
  }
  if (report.indirectChecks.supported) {
    assert.deepEqual(
      report.gpuLODChecks.results.map((r) => /** Returns r level. */ r.level),
      [0, 1, 2, -1],
    );
    assert.deepEqual(
      report.gpuLODChecks.results.map((r) =>
        /** Accumulates the input entries into one result. */ r.args.reduce(
          (sum, a) =>
            /** Computes the sum + (a[0] * a[1]) / 3 result. */ sum +
            (a[0] * a[1]) / 3,
          0,
        ),
      ),
      [12, 8, 1, 0],
    );
    report.gpuLODChecks.results.forEach((r) =>
      /** Delegates this operation to assert.equal. */ assert.equal(
        r.image.maxDifference,
        0,
        "GPU LOD matches CPU rendering",
      ),
    );
    assert.deepEqual(report.gpuLODChecks.hysteresis, [0, 0, 1, 1, 0]);
    assert.deepEqual(
      report.gpuLODChecks.resourcesBefore,
      report.gpuLODChecks.resourcesAfter,
    );
  }
}
