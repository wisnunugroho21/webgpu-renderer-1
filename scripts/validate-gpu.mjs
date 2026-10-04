import { startPreviewServer } from "./gpu/preview-server.mjs";
import { runRegressionScene } from "./gpu/regression-scene.mjs";
import {
  measureCameraCheck,
  measureResourceBenchmark,
  measureDynamicBenchmark,
  measureLoadingChecks,
  measureWorkerChecks,
  measureDrawBenchmark,
} from "./gpu/smoke-checks.mjs";
import { assertRegressionReport } from "./gpu/regression-assertions.mjs";
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

await import("./create-worker-fixture.mjs");
const workerFixture = await readFile("artifacts/worker-large.glb");
const server = await startPreviewServer(
  5187,
  Boolean(process.env.RENDERER_PREVIEW),
);
let browser;
try {
  await mkdir("artifacts", { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 2,
  });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("console", (msg) => {
    // Applies msg.type, consoleErrors.push, msg.text to the current callback state.

    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) =>
    /** Delegates this operation to pageErrors.push. */ pageErrors.push(
      error.message,
    ),
  );
  await page.goto("http://127.0.0.1:5187");
  try {
    await page.waitForFunction(
      () =>
        /** Evaluates the window.rendererApp?.frames >= 150 condition. */ window
          .rendererApp?.frames >= 150,
      {
        timeout: 30000,
      },
    );
  } catch (error) {
    throw new Error(
      JSON.stringify({
        pageErrors,
        consoleErrors,
        state: await page.evaluate(
          () => /** Builds a record containing text, errors. */ ({
            text: document.body.textContent,
            errors: window.rendererApp?.gpu?.errors,
          }),
        ),
      }),
      { cause: error },
    );
  }
  await page.setViewportSize({ width: 640, height: 480 });
  await page.waitForFunction(
    () =>
      /** Evaluates the window.rendererApp.canvas.width === 1280 && window.rendererApp.canvas.height === 960 condition. */ window
        .rendererApp.canvas.width === 1280 &&
      window.rendererApp.canvas.height === 960,
  );
  const cameraCheck = await page.evaluate(measureCameraCheck);
  assert.equal(cameraCheck.creations, 0);
  assert.ok(cameraCheck.sameBuffer && cameraCheck.moved);
  assert.deepEqual(
    cameraCheck.statsBefore,
    cameraCheck.statsAfter,
    "steady-state moves must not construct persistent GPU resources",
  );
  const resourceBenchmark = await page.evaluate(measureResourceBenchmark);
  const dynamicBenchmark = await page.evaluate(measureDynamicBenchmark);
  assert.equal(dynamicBenchmark.sharedBufferCreations, 0);
  assert.equal(dynamicBenchmark.arenaBuffers, 3);
  assert.equal(dynamicBenchmark.uploadBytes, 640000);
  await page.route("**/regression/triangle.glb?async-check", async (route) => {
    // Applies route.continue to the current callback state.

    await new Promise((resolve) =>
      /** Delegates this operation to setTimeout. */ setTimeout(resolve, 200),
    );
    await route.continue();
  });
  const loadingChecks = await page.evaluate(measureLoadingChecks);
  await page.route("**/worker-large.glb", (route) =>
    /** Delegates this operation to route.fulfill. */ route.fulfill({
      body: workerFixture,
      contentType: "model/gltf-binary",
    }),
  );
  const workerChecks = await page.evaluate(measureWorkerChecks);
  const drawBenchmark = await page.evaluate(measureDrawBenchmark);
  assert.equal(drawBenchmark.results.individual.stats.drawCalls, 10000);
  assert.equal(drawBenchmark.results.sorted.stats.drawCalls, 10000);
  assert.equal(drawBenchmark.results.instanced.stats.drawCalls, 1);
  assert.equal(drawBenchmark.results.instanced.stats.instances, 10000);
  assert.equal(
    drawBenchmark.results.individual.imageHash,
    drawBenchmark.results.instanced.imageHash,
  );
  assert.equal(
    drawBenchmark.results.sorted.imageHash,
    drawBenchmark.results.instanced.imageHash,
  );
  assert.equal(
    drawBenchmark.results["instanced-bvh"].imageHash,
    drawBenchmark.results.instanced.imageHash,
  );
  assert.equal(drawBenchmark.results["instanced-bvh"].stats.drawCalls, 1);
  assert.equal(
    drawBenchmark.results["instanced-bvh"].stats.visibleObjects,
    10000,
  );
  assert.equal(drawBenchmark.results["instanced-bvh"].stats.bvhNodesTested, 1);
  assert.deepEqual(drawBenchmark.resourceBefore, drawBenchmark.resourceAfter);
  await page.screenshot({ path: "artifacts/10000-cubes.png" });
  await page.evaluate(() => {
    // Applies app.world.destroy, app.world.transforms.setPosition, app.world.transforms.setScale to the current callback state.

    const app = window.rendererApp;
    for (let e = 1; e < app.world.nextEntity; e++)
      if (e !== app.defaultLightEntity) app.world.destroy(e);
    app.world.transforms.setPosition(app.sceneEntity, 0, 0, 0);
    app.world.transforms.setScale(app.sceneEntity, 1, 1, 1);
    app.transformSystem.update(app.world.transforms);
    app.animatedBounds.update(
      app.world,
      app.renderer.meshes,
      app.skeletons,
      app.animations.morphPool,
    );
    app.extractor.extract(
      app.world,
      app.renderWorld,
      app.skeletons,
      app.animations.morphPool,
    );
    app.renderer.camera.setPosition(3, 2, 5);
    app.renderer.submissionMode = "instanced";
    app.renderer.visibilityMode = "linear";
  });
  await page.screenshot({ path: "artifacts/cube.png" });
  const report = await page.evaluate(runRegressionScene);
  report.loadingChecks = loadingChecks;
  report.workerChecks = workerChecks;
  report.environment = {
    mode: process.env.RENDERER_PREVIEW ? "production-preview" : "development",
    browser: await browser.version(),
    timestamp: new Date().toISOString(),
  };
  await writeFile(
    "artifacts/final-regression.json",
    JSON.stringify(report, null, 2),
  );
  assertRegressionReport(report, pageErrors, workerChecks, loadingChecks);
  report.cameraCheck = cameraCheck;
  report.resourceBenchmark = resourceBenchmark;
  report.dynamicBenchmark = dynamicBenchmark;
  report.drawBenchmark = drawBenchmark;
  await writeFile(
    "artifacts/final-regression.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    server.kill("SIGTERM");
  }
}
