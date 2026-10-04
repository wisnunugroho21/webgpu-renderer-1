import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";
await mkdir("artifacts", { recursive: true });
const server = await startPreviewServer(5197, true);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on("pageerror", (error) =>
    /** Delegates this operation to errors.push. */ errors.push(error.message),
  );
  await page.goto("http://127.0.0.1:5197");
  await page.waitForFunction(
    () =>
      /** Evaluates the window.rendererApp?.frames >= 3 condition. */ window
        .rendererApp?.frames >= 3,
  );
  const report = await page.evaluate(async () => {
    // Builds a record containing picking, baseline, reduced, restored difference, disabled difference, edge difference.

    const app = window.rendererApp,
      r = app.renderer;
    app.stop();
    app.gpu.device.pushErrorScope("validation");
    /** Prepares the current scene, submits GPU work and reads pixels only for this diagnostic scenario. */
    const draw = async () => {
      const texture = app.gpu.context.getCurrentTexture();
      const encoder = app.gpu.device.createCommandEncoder();
      r.encode(encoder, texture.createView({ format: app.gpu.renderFormat }));
      const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
      const buffer = app.gpu.device.createBuffer({
        size: bytesPerRow * texture.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
        texture.width,
        texture.height,
      ]);
      app.gpu.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap();
      buffer.destroy();
      return { bytes, width: texture.width, height: texture.height };
    };
    /** Compares diagnostic pixel buffers and reports their differing values. */
    const difference = (a, b) =>
      a.bytes.reduce(
        (n, v, i) =>
          /** Computes the n + Number(v !== b.bytes[i]) result. */ n +
          Number(v !== b.bytes[i]),
        0,
      );
    const baseline = await draw();
    const rect = app.canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2,
      centerY = rect.top + rect.height / 2;
    const picking = {
      original: app.pick(centerX, centerY)?.index,
      outside: app.pick(rect.right + 1, centerY),
    };
    app.gpu.renderScale = 0.5;
    const reduced = await draw();
    picking.reduced = app.pick(centerX, centerY)?.index;
    app.gpu.renderScale = 1;
    const restored = await draw();
    const setup = performance.now();
    r.antialiasing = "fxaa";
    const setupMs = performance.now() - setup;
    const aa = await draw();
    const before = { ...r.resources.stats };
    for (let i = 0; i < 10; i++) await draw();
    const after = { ...r.resources.stats };
    const modes = [];
    for (const mode of ["individual", "sorted", "instanced", "gpu-indirect"]) {
      if (mode === "gpu-indirect" && !r.gpuDraws.supported) continue;
      r.submissionMode = mode;
      modes.push({ mode, difference: difference(aa, await draw()) });
    }
    r.submissionMode = "instanced";
    const timings = [];
    for (const mode of ["none", "fxaa"]) {
      r.antialiasing = mode;
      for (let i = 0; i < 3; i++) await draw();
      const values = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        const encoder = app.gpu.device.createCommandEncoder();
        r.encode(
          encoder,
          app.gpu.context
            .getCurrentTexture()
            .createView({ format: app.gpu.renderFormat }),
        );
        app.gpu.queue.submit([encoder.finish()]);
        await app.gpu.queue.onSubmittedWorkDone();
        values.push(performance.now() - start);
      }
      values.sort((a, b) => /** Computes the a - b result. */ a - b);
      timings.push({ mode, completionMedianMs: values[5] });
    }
    r.antialiasing = "none";
    const disabled = await draw();
    r.hdr.enabled = true;
    r.antialiasing = "fxaa";
    const hdr = await draw();
    r.depthPrepass.enabled = true;
    const depth = await draw();
    const hdrDepthDifference = difference(hdr, depth);
    r.hdr.enabled = false;
    r.depthPrepass.enabled = false;
    app.gpu.renderScale = 0.5;
    await draw();
    r.camera.setOrthographic({ height: 10 });
    await draw();
    picking.orthographic = app.pick(centerX, centerY)?.index;
    app.world.destroy(app.sceneEntity);
    picking.stale = app.pick(centerX, centerY);
    picking.expected = app.sceneEntity;
    const validation = await app.gpu.device.popErrorScope();
    const old = r.resources;
    app.autoRecoverDevice = false;
    await app.recoverDevice();
    const recovery = {
      scale: app.gpu.renderScale,
      antialiasing: app.renderer.antialiasing,
    };
    const gpuErrors = [...app.gpu.errors];
    await app.dispose();
    return {
      picking,
      baseline: [baseline.width, baseline.height],
      reduced: [reduced.width, reduced.height],
      restoredDifference: difference(baseline, restored),
      disabledDifference: difference(baseline, disabled),
      edgeDifference: difference(baseline, aa),
      setupMs,
      before,
      after,
      modes,
      timings,
      hdrDepthDifference,
      validation: validation?.message ?? null,
      recovery,
      gpuErrors,
      oldLive: [old.stats.buffers, old.stats.textures],
      finalLive: [
        app.renderer.resources.stats.buffers,
        app.renderer.resources.stats.textures,
      ],
    };
  });
  assert.deepEqual(
    report.reduced,
    report.baseline.map(
      (value) => /** Computes the value / 2 result. */ value / 2,
    ),
  );
  assert.equal(report.restoredDifference, 0);
  assert.equal(report.disabledDifference, 0);
  assert.ok(report.edgeDifference > 0);
  assert.equal(report.hdrDepthDifference, 0);
  for (const mode of report.modes) assert.equal(mode.difference, 0);
  for (const key of [
    "pipelineCreations",
    "bufferCreations",
    "textureCreations",
    "shaderModules",
    "samplerCreations",
  ])
    assert.equal(report.before[key], report.after[key]);
  assert.equal(report.validation, null);
  assert.deepEqual(report.recovery, { scale: 0.5, antialiasing: "fxaa" });
  assert.deepEqual(report.oldLive, [0, 0]);
  assert.deepEqual(report.finalLive, [0, 0]);
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/quality-gpu.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
