import assert from "node:assert/strict";
import { clearPixel } from "./pixel-references.mjs";

/** Validate animation, skinning, morphs, conservative bounds and CPU LOD. */
export function assertDeformationReport(report) {
  const expected = clearPixel(report.format);
  assert.equal(report.animationChecks.time, 0.5);
  assert.equal(report.animationChecks.position, 5);
  assert.equal(report.animationChecks.scale, 0.75);
  report.animationChecks.rotation.forEach((v) =>
    /** Delegates this operation to assert.ok. */ assert.ok(
      Math.abs(v - Math.SQRT1_2) < 1e-6,
    ),
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
  report.skinChecks.renderIds.forEach((id) =>
    /** Delegates this operation to assert.ok. */ assert.ok(id >= 0),
  );
  assert.ok(Math.abs(report.skinChecks.weights[0] - 128 / 255) < 1e-6);
  assert.ok(Math.abs(report.skinChecks.weights[1] - 127 / 255) < 1e-6);
  assert.equal(report.skinChecks.changed, 4);
  assert.equal(report.skinChecks.unchanged, 0);
  const matrixX = report.skinChecks.initialMatrices.map(
    (m) => /** Returns m[12]. */ m[12],
  );
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
    report.skinChecks.initialMatrices.map((m) => /** Returns m[12]. */ m[12]),
    "GPU palettes match CPU instance order",
  );
  assert.deepEqual(
    report.jointChecks.resourcesBefore,
    report.jointChecks.resourcesAfter,
  );
  report.gpuSkinChecks.skinPixel.forEach((v, i) =>
    /** Delegates this operation to assert.ok. */ assert.ok(
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
  assert.equal(
    new Set(
      report.morphChecks.states.map((s) => /** Returns s offset. */ s.offset),
    ).size,
    2,
  );
  report.morphChecks.states.forEach((s) => {
    // Applies assert.ok, assert.equal to the current callback state.

    assert.ok(s.shared);
    assert.equal(s.count, 1);
  });
  const defaults = report.morphChecks.states
    .map((s) => /** Returns s weights[0]. */ s.weights[0])
    .sort();
  assert.ok(
    Math.abs(defaults[0] - 0.1) < 1e-6 && Math.abs(defaults[1] - 0.2) < 1e-6,
    "node override and mesh defaults",
  );
  report.morphChecks.targets.forEach((t) => {
    // Applies assert.equal, assert.deepEqual to the current callback state.

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
    /** Delegates this operation to assert.ok. */ assert.ok(
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
    /** Delegates this operation to assert.ok. */ assert.ok(
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
    report.lodChecks.results.map(
      (r) => /** Returns r selection. */ r.selection,
    ),
    [0, 1, 2, -1],
  );
  assert.deepEqual(
    report.lodChecks.results.map(
      (r) => /** Returns r stats triangles. */ r.stats.triangles,
    ),
    [12, 8, 1, 0],
  );
  assert.equal(report.lodChecks.results[3].stats.lodCulled, 1);
  assert.deepEqual(
    report.lodChecks.resourcesBefore,
    report.lodChecks.resourcesAfter,
  );
}
