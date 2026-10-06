import assert from "node:assert/strict";

/** Validate compressed assets, streaming, responsiveness, temporal reuse and device loss. */
export function assertAssetAndTemporalReport(
  report,
  workerChecks,
  loadingChecks,
) {
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
  assert.equal(
    workerChecks.mainEventLoopTurns,
    0,
    "synchronous reference blocks macrotasks",
  );
  assert.ok(
    workerChecks.workerEventLoopTurns >= 1,
    "worker decode leaves the main event loop responsive",
  );
  assert.equal(workerChecks.metrics.workerJobs, 4);
  assert.ok(workerChecks.metrics.transferredInputBytes >= 1000000);
  assert.equal(workerChecks.prepared, true);
  assert.ok(workerChecks.upload.chunks > 2);
  assert.ok(workerChecks.upload.maxChunk <= 1024 * 1024);
  assert.ok(
    workerChecks.upload.eventLoopTurns >= 1,
    "chunked upload yields to main-thread tasks",
  );
  assert.equal(workerChecks.upload.buffersRestored, true);
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
  assert.ok(
    loadingChecks.eventLoopTurns >= 3,
    "async loading leaves the main event loop responsive",
  );
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
