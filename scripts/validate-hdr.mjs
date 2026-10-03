import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";
await mkdir("artifacts", { recursive: true });
const server = await startPreviewServer(5194, true);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5194");
  await page.waitForFunction(() => window.rendererApp?.frames >= 3);
  const report = await page.evaluate(async () => {
    const app = window.rendererApp,
      r = app.renderer,
      w = app.world,
      device = app.gpu.device;
    app.stop();
    device.pushErrorScope("validation");
    const extract = () => {
      app.transformSystem.update(w.transforms);
      app.skeletonSystem.update(w, app.skeletons);
      app.extractor.extract(
        w,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
    };
    const draw = async () => {
      extract();
      const texture = app.gpu.context.getCurrentTexture(),
        encoder = device.createCommandEncoder();
      r.encode(encoder, texture.createView({ format: app.gpu.renderFormat }));
      const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
      const buffer = device.createBuffer({
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
      return {
        bytes,
        center:
          bytes[
            Math.floor(texture.height / 2) * bytesPerRow +
              Math.floor(texture.width / 2) * 4
          ],
      };
    };
    const difference = (a, b) =>
      a.reduce((n, v, i) => n + Number(v !== b[i]), 0);
    const baseline = await draw(),
      baselineResources = { ...r.resources.stats };
    const start = performance.now();
    r.hdr.enabled = true;
    const setupMs = performance.now() - start;
    await draw();
    r.hdr.enabled = false;
    const disabled = await draw();
    const restoredDifference = difference(baseline.bytes, disabled.bytes);
    w.destroy(app.sceneEntity);
    const values = [];
    r.hdr.enabled = true;
    for (const value of [0, 0.18, 1, 2, 4, 16, 65504, 1e6]) {
      r.clearColor = { r: value, g: value, b: value, a: 1 };
      values.push({ value, pixel: (await draw()).center });
    }
    r.clearColor = { r: 1, g: 1, b: 1, a: 1 };
    r.hdr.exposure = 1;
    const doubled = (await draw()).center;
    r.hdr.exposure = -1;
    const halved = (await draw()).center;
    r.hdr.exposure = 16;
    const maximum = (await draw()).center;
    r.hdr.exposure = -16;
    const minimum = (await draw()).center;
    r.hdr.exposure = 0;
    let invalid = 0;
    for (const value of [NaN, Infinity, -17, 17])
      try {
        r.hdr.exposure = value;
      } catch {
        invalid++;
      }
    try {
      r.hdr.toneMapping = "bad";
    } catch {
      invalid++;
    }
    r.hdr.toneMapping = "clamp";
    r.clearColor = { r: 0.18, g: 0.18, b: 0.18, a: 1 };
    const identity = (await draw()).center;
    r.hdr.enabled = false;
    const legacyIdentity = (await draw()).center;
    r.hdr.enabled = true;
    r.hdr.toneMapping = "reinhard";
    // A transparent emissive cube must blend radiance (4 * .5) before mapping.
    r.clearColor = { r: 0, g: 0, b: 0, a: 1 };
    w.lights.intensity[app.defaultLightEntity] = 0;
    const entity = w.create();
    w.transforms.add(entity);
    w.bounds.setSphere(entity, 0, 0, 0, 2);
    const material = app.materials.create({
      baseColor: [0, 0, 0, 0.5],
      metallic: 1,
      emissive: [4, 4, 4],
      alphaMode: "BLEND",
    });
    w.meshes.set(entity, 0, material);
    const blend = (await draw()).center;
    const modeResults = [];
    for (const mode of ["individual", "sorted", "instanced", "gpu-indirect"]) {
      r.submissionMode = mode;
      await draw();
      const image = await draw();
      modeResults.push({ mode, pixel: image.center });
    }
    w.destroy(entity);
    await app.loadAsset("/regression/crowd-combined.glb");
    r.depthPrepass.enabled = true;
    r.shadows.enabled = true;
    w.lights.castShadow[app.defaultLightEntity] = 1;
    await draw();
    const data = {
      diffuse: {
        size: 1,
        faces: Array.from({ length: 6 }, () => new Float32Array([4, 4, 4, 1])),
      },
      specular: [
        {
          size: 1,
          faces: Array.from(
            { length: 6 },
            () => new Float32Array([4, 4, 4, 1]),
          ),
        },
      ],
      brdf: { size: 1, pixels: new Float32Array([0.8, 0.05, 0, 1]) },
    };
    // Install while HDR is disabled after its first use, then reuse cached HDR state.
    r.hdr.enabled = false;
    await r.setEnvironment(data);
    r.hdr.enabled = true;
    await draw();
    const environmentModes = [];
    r.submissionMode = "instanced";
    await draw();
    const environmentReference = await draw();
    for (const mode of ["individual", "sorted", "instanced", "gpu-indirect"]) {
      r.submissionMode = mode;
      await draw();
      const image = await draw();
      environmentModes.push({
        mode,
        difference: difference(environmentReference.bytes, image.bytes),
      });
    }
    r.submissionMode = "instanced";
    const resources = { ...r.resources.stats };
    const benchmark = async (enabled) => {
      r.hdr.enabled = enabled;
      extract();
      const cpu = [],
        completion = [];
      for (let i = 0; i < 90; i++) {
        const texture = app.gpu.context.getCurrentTexture(),
          encoder = device.createCommandEncoder(),
          start = performance.now();
        r.encode(encoder, texture.createView({ format: app.gpu.renderFormat }));
        const encoded = performance.now();
        app.gpu.queue.submit([encoder.finish()]);
        await app.gpu.queue.onSubmittedWorkDone();
        if (i >= 30) {
          cpu.push(encoded - start);
          completion.push(performance.now() - start);
        }
      }
      const median = (a) => a.sort((a, b) => a - b)[Math.floor(a.length / 2)];
      return { cpuEncodeMs: median(cpu), gpuCompletionMs: median(completion) };
    };
    const off = await benchmark(false),
      on = await benchmark(true),
      offAgain = await benchmark(false);
    const overdrawEntities = [];
    const transparent = app.materials.create({
      baseColor: [0, 0, 0, 0.08],
      metallic: 1,
      emissive: [4, 4, 4],
      alphaMode: "BLEND",
      doubleSided: true,
    });
    for (let i = 0; i < 32; i++) {
      const id = w.create();
      overdrawEntities.push(id);
      w.transforms.add(id);
      w.transforms.setScale(id, 4, 4, 4);
      w.transforms.setPosition(id, 0, 0, -i * 0.02);
      w.meshes.set(id, 0, transparent);
      w.bounds.setSphere(id, 0, 0, 0, 2);
    }
    r.depthPrepass.enabled = false;
    r.shadows.enabled = false;
    const overdrawOff = await benchmark(false),
      overdrawOn = await benchmark(true);
    for (const id of overdrawEntities) w.destroy(id);
    r.hdr.enabled = true;
    r.gpuProfiler.enabled = true;
    await draw();
    r.gpuProfiler.enabled = false;
    const timestamps = await r.gpuProfiler.readSamples();
    r.hiz.debugEnabled = true;
    await draw();
    r.hiz.debugEnabled = false;
    const warmResources = { ...r.resources.stats };
    const validationError = await device.popErrorScope("validation");
    return {
      baselineResources,
      setupMs,
      restoredDifference,
      values,
      doubled,
      halved,
      maximum,
      minimum,
      invalid,
      identity,
      legacyIdentity,
      blend,
      modeResults,
      off,
      on,
      offAgain,
      resources,
      warmResources,
      environmentModes,
      overdrawOff,
      overdrawOn,
      timestamps,
      validationError: validationError?.message ?? null,
      gpuErrors: app.gpu.errors,
    };
  });
  const srgb = (x) =>
    Math.round(
      255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055),
    );
  assert.equal(report.restoredDifference, 0);
  for (const { value, pixel } of report.values)
    assert.ok(
      Math.abs(
        pixel - srgb(Math.min(value, 65504) / (1 + Math.min(value, 65504))),
      ) <= 1,
      `${value}: ${pixel}`,
    );
  assert.ok(Math.abs(report.doubled - srgb(2 / 3)) <= 1);
  assert.ok(Math.abs(report.halved - srgb(1 / 3)) <= 1);
  assert.equal(report.maximum, 255);
  assert.equal(report.minimum, 0);
  assert.equal(report.invalid, 5);
  assert.equal(report.identity, report.legacyIdentity);
  assert.ok(
    Math.abs(report.blend - srgb(2 / 3)) <= 1,
    `linear blend: ${report.blend}`,
  );
  for (const mode of report.modeResults) assert.equal(mode.pixel, report.blend);
  for (const key of [
    "pipelineCreations",
    "shaderModules",
    "bufferCreations",
    "textureCreations",
    "samplerCreations",
    "buffers",
    "textures",
    "bufferBytes",
  ])
    assert.equal(report.resources[key], report.warmResources[key]);
  for (const mode of report.environmentModes)
    assert.equal(mode.difference, 0, mode.mode);
  if (report.timestamps.length)
    assert.ok(report.timestamps.some((t) => t.pass === 11));
  assert.equal(report.validationError, null);
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.evaluate(async () => {
    const app = window.rendererApp;
    app.gpu.resize();
    app.renderer.resize();
    const encoder = app.gpu.device.createCommandEncoder();
    app.renderer.encode(
      encoder,
      app.gpu.context
        .getCurrentTexture()
        .createView({ format: app.gpu.renderFormat }),
    );
    app.gpu.queue.submit([encoder.finish()]);
    await app.gpu.queue.onSubmittedWorkDone();
    if (app.gpu.errors.length) throw new Error(app.gpu.errors.join("\n"));
    await app.dispose();
    if (
      app.renderer.resources.stats.textures ||
      app.renderer.resources.stats.buffers
    )
      throw new Error("GPU resource leak");
  });
  await page.goto("http://127.0.0.1:5194/?example=lighting");
  await page.waitForFunction(
    () => window.environmentDemoReady && window.rendererApp.frames > 3,
  );
  assert.equal(
    await page.evaluate(() => window.rendererApp.renderer.hdr.enabled),
    true,
  );
  const demoResources = await page.evaluate(() => ({
    ...window.rendererApp.renderer.resources.stats,
  }));
  await page.locator("canvas").click();
  await page.keyboard.press("h");
  await page.waitForFunction(() => !window.rendererApp.renderer.hdr.enabled);
  await page.keyboard.press("h");
  await page.waitForFunction(() => window.rendererApp.renderer.hdr.enabled);
  await page.keyboard.press("=");
  await page.waitForFunction(
    () => window.rendererApp.renderer.hdr.exposure === 0.5,
  );
  await page.keyboard.press("-");
  await page.waitForFunction(
    () => window.rendererApp.renderer.hdr.exposure === 0,
  );
  await page.screenshot({ path: "artifacts/hdr-lighting.png" });
  assert.deepEqual(
    await page.evaluate(() => ({
      ...window.rendererApp.renderer.resources.stats,
    })),
    demoResources,
  );
  assert.deepEqual(
    await page.evaluate(() => window.rendererApp.gpu.errors),
    [],
  );
  assert.deepEqual(errors, []);
  report.demoControls = true;
  await writeFile("artifacts/hdr.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
