import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

/** Compare default rendering invariants while separately recording optical ABI allocation deltas. */
export function compareBenchmarks(baseline, current) {
  let compared = 0;
  const acceptedDeltas = [],
    timings = [];
  const deltas = {
    textureCreations: 1,
    textures: 1,
    textureBytes: 8,
    bufferBytes: 196608,
  };
  const visit = (previous, next, path = "") => {
    // Timing evidence is environment-specific; counts, pixels and uploads must remain deterministic.
    const key = path.split(".").at(-1);
    if (key === "environment") return;
    if (key === "fps" || key?.endsWith("Ms")) {
      timings.push({ path, baseline: previous, current: next });
      return;
    }
    if (key === "cacheHits") {
      // Two additional logical texture roles add cold sampler-cache lookups without GPU creation.
      acceptedDeltas.push({
        path,
        baseline: previous,
        current: next,
        reason: "optical sampler lookups",
      });
      return;
    }
    if (previous !== null && typeof previous === "object") {
      assert.ok(
        next !== null && typeof next === "object",
        `Missing object ${path}`,
      );
      if (Array.isArray(previous))
        assert.equal(next.length, previous.length, `Array length ${path}`);
      for (const name of Object.keys(previous))
        visit(previous[name], next[name], path ? `${path}.${name}` : name);
      if (key === "stats")
        for (const name of Object.keys(next)) {
          // Added opt-in work counters must stay zero in the previous default workloads.
          if (!(name in previous))
            assert.equal(
              next[name],
              name === "shadowBudgetTexels"
                ? ((previous.shadowPasses ?? 0) +
                    (previous.shadowCacheHits ?? 0)) *
                    1024 *
                    1024
                : 0,
              `Unexpected default work ${path}.${name}`,
            );
        }
      return;
    }
    if (/\.resources(Before|After)\./.test(path) && key in deltas) {
      assert.equal(
        next,
        previous + deltas[key],
        `Unexpected resource delta ${path}`,
      );
      acceptedDeltas.push({ path, delta: deltas[key] });
    } else assert.deepEqual(next, previous, `Rendering invariant ${path}`);
    compared++;
  };
  visit(baseline, current);
  return {
    compared,
    acceptedDeltas,
    timings,
    environment: current.environment,
  };
}

// Only run file orchestration when invoked directly; CPU tests import the strict comparator.
if (process.argv[1]?.endsWith("compare-benchmarks.mjs")) {
  const baseline = JSON.parse(
    await readFile(
      process.argv[2] ?? "benchmarks/results/transparency-matrix.json",
      "utf8",
    ),
  );
  const current = JSON.parse(
    await readFile(
      process.argv[3] ?? "artifacts/benchmark-matrix-long.json",
      "utf8",
    ),
  );
  const result = compareBenchmarks(baseline, current);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/improvements-comparison.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    `Compared ${result.compared} rendering invariants; documented optical allocation deltas accepted.`,
  );
}
