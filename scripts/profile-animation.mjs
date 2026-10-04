import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";

// Sampling is diagnostic only. The measured stage excludes GPU work and matrix updates.
const server = await startPreviewServer(5190);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5190");
  await page.waitForFunction(
    () =>
      /** Evaluates the window.rendererApp?.frames >= 3 condition. */ window
        .rendererApp?.frames >= 3,
  );
  const longAnimation = process.argv.includes("--long-animation");
  await page.evaluate(async (longAnimation) => {
    // Applies original.stop, document.createElement, app.start to the current callback state.

    const original = window.rendererApp;
    original.stop();
    const app = new original.constructor(
      document.createElement("canvas"),
      document.createElement("output"),
      100000,
      16384,
    );
    await app.start();
    app.stop();
    window.animationProfileApp = app;
    for (let i = 0; i < 1000; i++) {
      await app.loadAsset(
        longAnimation
          ? "/regression/crowd-skin-long.glb"
          : "/regression/crowd-skin.glb",
      );
      const animator = app.animations.animators[i];
      animator.play(0);
      animator.currentTime = longAnimation ? (i * 30) / 1000 : (i % 10) * 0.01;
    }
  }, longAnimation);
  const session = await page.context().newCDPSession(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  const result = await page.evaluate(() => {
    // Returns rows.

    const app = window.animationProfileApp,
      rows = [];
    for (let frame = 0; frame < 60; frame++) {
      // Mimic consumption of dirty records by TransformSystem between animation updates.
      app.world.transforms.dirty.fill(0);
      app.world.transforms.queued.fill(0);
      app.world.transforms.dirtyCount = 0;
      const start = performance.now();
      app.animations.update(1 / 60);
      if (frame >= 10) rows.push(performance.now() - start);
    }
    return rows;
  });
  await session.send("Profiler.start");
  await page.evaluate(() => {
    // Applies app.world.transforms.dirty.fill, app.world.transforms.queued.fill, app.animations.update to the current callback state.

    const app = window.animationProfileApp;
    for (let frame = 0; frame < 100; frame++) {
      app.world.transforms.dirty.fill(0);
      app.world.transforms.queued.fill(0);
      app.world.transforms.dirtyCount = 0;
      app.animations.update(1 / 60);
    }
  });
  const { profile } = await session.send("Profiler.stop");
  const nodes = new Map(
    profile.nodes.map(
      (node) => /** Returns the ordered values needed by this operation. */ [
        node.id,
        node,
      ],
    ),
  );
  const times = new Map();
  for (let index = 0; index < profile.samples.length; index++) {
    const frame = nodes.get(profile.samples[index]).callFrame;
    const name = `${frame.functionName || "(anonymous)"}:${frame.lineNumber + 1}`;
    times.set(name, (times.get(name) ?? 0) + profile.timeDeltas[index]);
  }
  const report = {
    workload:
      "1000 independent characters x 64 joints; 60 frames, last 50 measured",
    keyCount: longAnimation ? 1024 : 2,
    distinctPhases: longAnimation ? 1000 : 10,
    animationMedianMs: result.sort(
      (a, b) => /** Computes the a - b result. */ a - b,
    )[Math.floor(result.length / 2)],
    selfTimeMs: [...times]
      .sort((a, b) => /** Computes the b[1] - a[1] result. */ b[1] - a[1])
      .map(([name, us]) => /** Builds a record containing name, ms. */ ({
        name,
        ms: us / 1000,
      })),
  };
  await mkdir("artifacts", { recursive: true });
  const label =
    process.argv
      .slice(2)
      .find(
        (arg) => /** Returns !arg.startsWith("--"). */ !arg.startsWith("--"),
      ) ?? "current";
  await writeFile(
    `artifacts/animation-profile-${label}.json`,
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    `artifacts/animation-${label}.cpuprofile`,
    JSON.stringify(profile),
  );
  console.log(JSON.stringify(report, null, 2));
  await page.evaluate(() =>
    /** Delegates this operation to window.animationProfileApp.dispose. */ window.animationProfileApp.dispose(),
  );
} finally {
  try {
    await browser?.close();
  } finally {
    server.kill("SIGTERM");
  }
}
