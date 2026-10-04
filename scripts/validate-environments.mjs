import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";
await mkdir("artifacts", { recursive: true });
const bytes = new Uint8Array([
  ...new TextEncoder().encode(
    "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n",
  ),
  ...Array.from({ length: 4 }, () => [128, 128, 128, 129]).flat(),
]);
await writeFile("artifacts/environment-source.hdr", bytes);
const baked = spawnSync(
  process.execPath,
  [
    "scripts/bake-environment.mjs",
    "artifacts/environment-source.hdr",
    "artifacts/environment.envbin",
    "--specular-size",
    "2",
    "--diffuse-size",
    "1",
    "--brdf-size",
    "2",
    "--samples",
    "8",
  ],
  { encoding: "utf8" },
);
if (baked.status !== 0) throw new Error(baked.stderr || baked.stdout);
const archive = await readFile("artifacts/environment.envbin");
const server = await startPreviewServer(5196, true);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/environment.hdr", (r) =>
    r.fulfill({
      body: Buffer.from(bytes),
      contentType: "application/octet-stream",
    }),
  );
  await page.route("**/environment.envbin", (route) =>
    route.fulfill({ body: archive, contentType: "application/octet-stream" }),
  );
  await page.goto("http://127.0.0.1:5196");
  await page.waitForFunction(() => window.rendererApp?.frames >= 3);
  const report = await page.evaluate(async () => {
    const app = window.rendererApp;
    app.stop();
    const r = app.renderer,
      w = app.world;
    w.destroy(app.sceneEntity);
    r.skybox.enabled = true;
    r.hdr.enabled = true;
    app.gpu.device.pushErrorScope("validation");
    const start = performance.now();
    await app.loadEnvironment("/environment.hdr", {
      specularSize: 2,
      diffuseSize: 1,
      brdfSize: 2,
      samples: 8,
    });
    const coldMs = performance.now() - start;
    const cached = performance.now();
    await app.loadEnvironment("/environment.hdr", {
      specularSize: 2,
      diffuseSize: 1,
      brdfSize: 2,
      samples: 8,
    });
    const cachedMs = performance.now() - cached;
    const draw = async () => {
      app.transformSystem.update(w.transforms);
      app.extractor.extract(
        w,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
      const texture = app.gpu.context.getCurrentTexture(),
        encoder = app.gpu.device.createCommandEncoder();
      r.encode(encoder, texture.createView({ format: app.gpu.renderFormat }));
      const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256,
        buffer = app.gpu.device.createBuffer({
          size: bytesPerRow * texture.height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
        texture.width,
        texture.height,
      ]);
      app.gpu.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap();
      buffer.destroy();
      return {
        data,
        center:
          data[
            Math.floor(texture.height / 2) * bytesPerRow +
              Math.floor(texture.width / 2) * 4
          ],
        corner: data[0],
      };
    };
    const sky = await draw();
    const archiveStart = performance.now();
    await app.loadEnvironment("/environment.envbin");
    const archiveMs = performance.now() - archiveStart,
      archiveImage = await draw();
    const archiveDifference = sky.data.reduce(
      (n, value, index) => n + Number(value !== archiveImage.data[index]),
      0,
    );

    r.environment.enabled = false;
    r.environment.intensity = 2;
    const independent = await draw();
    r.environment.intensity = 1;
    r.hdr.enabled = false;
    const ldr = await draw();
    r.hdr.enabled = true;
    const entity = w.createHandle(),
      id = w.require(entity);
    w.transforms.add(id);
    w.bounds.setSphere(id, 0, 0, 0, 2);
    const material = app.materials.create({
      baseColor: [0, 0, 0, 1],
      metallic: 1,
    });
    w.meshes.set(id, 0, material);
    w.lights.intensity[app.defaultLightEntity] = 0;
    const opaque = await draw();
    r.depthPrepass.enabled = true;
    const prepass = await draw();
    r.skybox.enabled = false;
    const disabled = await draw();
    r.skybox.enabled = true;
    await draw();
    const resources = { ...r.resources.stats },
      samples = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now(),
        encoder = app.gpu.device.createCommandEncoder();
      r.encode(
        encoder,
        app.gpu.context
          .getCurrentTexture()
          .createView({ format: app.gpu.renderFormat }),
      );
      app.gpu.queue.submit([encoder.finish()]);
      await app.gpu.queue.onSubmittedWorkDone();
      if (i >= 30) samples.push(performance.now() - start);
    }
    const warm = { ...r.resources.stats },
      validationError = await app.gpu.device.popErrorScope();
    const data = {
      archiveMs,
      archiveDifference,
      worker: { ...app.environments.preparation.metrics },
      coldMs,
      cachedMs,
      sky: sky.center,
      independent: independent.center,
      ldr: ldr.center,
      opaque: opaque.center,
      opaqueCorner: opaque.corner,
      prepass: prepass.center,
      disabledCorner: disabled.corner,
      resources,
      warm,
      completionMs: samples.sort((a, b) => a - b)[15],
      cache: {
        ...app.environments.metrics,
        size: app.environments.size,
        bytes: app.environments.cachedBytes,
      },
      validationError: validationError?.message ?? null,
      gpuErrors: app.gpu.errors,
    };
    app.autoRecoverDevice = false;
    const previous = app.gpu;
    previous.device.destroy();
    await previous.device.lost;
    await app.recoverDevice();
    data.recoveredSkybox = app.renderer.skybox.enabled;
    await app.dispose();
    return data;
  });
  assert.equal(report.sky, 188);
  assert.equal(report.independent, 213);
  assert.equal(report.ldr, 255);
  assert.equal(report.opaque, 0);
  assert.equal(report.prepass, 0);
  assert.equal(report.opaqueCorner, 188);
  assert.ok(
    report.disabledCorner < 60,
    "Disabled skybox restores the dark clear color",
  );
  assert.deepEqual(report.resources, report.warm);
  assert.equal(report.cache.bakes, 1);
  assert.equal(report.cache.hits, 1);
  assert.equal(report.archiveDifference, 0);
  assert.ok(report.worker.jobs >= 2);
  assert.equal(report.validationError, null);
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(errors, []);
  assert.equal(report.recoveredSkybox, true);
  await writeFile(
    "artifacts/environment-loading.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
