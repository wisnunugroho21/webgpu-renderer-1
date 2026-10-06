import { launchValidationBrowser } from "./gpu/validation-browser.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";
await mkdir("artifacts", { recursive: true });
const server = await startPreviewServer(5198, true);
let browser;
try {
  browser = await launchValidationBrowser();
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } }),
    errors = [];
  page.on("pageerror", (error) =>
    /** Delegates this operation to errors.push. */ errors.push(error.message),
  );
  await page.goto("http://127.0.0.1:5198");
  await page.waitForFunction(
    () =>
      /** Evaluates the window.rendererApp?.frames >= 3 condition. */ window
        .rendererApp?.frames >= 3,
  );
  const report = await page.evaluate(async () => {
    // Builds a record containing filmic, auto one, auto four, frozen, compensation, odd.

    const app = window.rendererApp;
    app.stop();
    let r = app.renderer;
    const w = app.world;
    app.gpu.device.pushErrorScope("validation");
    w.destroy(app.sceneEntity);
    /** Prepares the current scene, submits GPU work and reads pixels only for this diagnostic scenario. */
    const draw = async () => {
      app.transformSystem.update(w.transforms);
      app.skeletonSystem.update(w, app.skeletons);
      app.animatedBounds.update(
        w,
        r.meshes,
        app.skeletons,
        app.animations.morphPool,
      );
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
    /** Compares diagnostic pixel buffers and reports their differing values. */
    const difference = (a, b) =>
      a.bytes.reduce(
        (n, value, index) =>
          /** Computes the n + Number(value !== b.bytes[index]) result. */ n +
          Number(value !== b.bytes[index]),
        0,
      );
    r.hdr.enabled = true;
    r.clearColor = { r: 0.18, g: 0.18, b: 0.18, a: 1 };
    r.hdr.toneMapping = "filmic";
    const filmic = (await draw()).center;
    r.hdr.toneMapping = "reinhard";
    r.hdr.autoExposure = true;
    r.hdr.adaptationSpeed = 100;
    r.hdr.frameDeltaSeconds = 1;
    r.clearColor = { r: 1, g: 1, b: 1, a: 1 };
    const autoOne = (await draw()).center;
    r.clearColor = { r: 4, g: 4, b: 4, a: 1 };
    const autoFour = (await draw()).center;
    r.hdr.adaptationSpeed = 0;
    r.clearColor = { r: 1, g: 1, b: 1, a: 1 };
    const frozen = (await draw()).center;
    r.hdr.adaptationSpeed = 100;
    r.hdr.exposure = 1;
    const compensation = (await draw()).center;
    r.hdr.exposure = 0;
    app.canvas.style.width = "641px";
    app.canvas.style.height = "479px";
    app.gpu.resize();
    const odd = (await draw()).center;
    r.clearColor = { r: 0, g: 0, b: 0, a: 1 };
    const black = (await draw()).center;
    r.hdr.autoExposure = false;
    r.clearColor = { r: 0, g: 0, b: 0, a: 1 };
    r.camera.setPosition(0, 0, 4);
    r.camera.setTarget(0, 0, 0);
    w.lights.intensity[app.defaultLightEntity] = 0;
    const entity = w.createHandle(),
      id = w.require(entity);
    w.transforms.add(id);
    w.transforms.setScale(id, 0.3, 0.3, 0.3);
    w.bounds.setSphere(id, 0, 0, 0, Math.sqrt(3));
    const material = app.materials.create({
      baseColor: [0, 0, 0, 1],
      metallic: 1,
      emissive: [8, 8, 8],
    });
    w.meshes.set(id, 0, material);
    const noBloom = await draw();
    r.hdr.bloomStrength = 0.3;
    const bloom = await draw();
    const halo = noBloom.bytes.reduce(
      (n, value, index) =>
        /** Computes the n + Number(index % 4 === 0 && value === 0 && bloom.bytes[index] > 0) result. */ n +
        Number(index % 4 === 0 && value === 0 && bloom.bytes[index] > 0),
      0,
    );
    r.hdr.bloomStrength = 0;
    const restored = await draw();
    r.hdr.bloomStrength = 0.3;
    r.hdr.autoExposure = true;
    r.antialiasing = "fxaa";
    await draw();
    const before = { ...r.resources.stats };
    for (let i = 0; i < 10; i++) await draw();
    const after = { ...r.resources.stats };
    const reference = await draw(),
      modes = [];
    for (const mode of ["individual", "sorted", "instanced", "gpu-indirect"]) {
      if (mode === "gpu-indirect" && !r.gpuDraws.supported) continue;
      r.submissionMode = mode;
      modes.push({ mode, difference: difference(reference, await draw()) });
    }
    r.submissionMode = "instanced";
    const timing = [];
    for (const effects of [false, true]) {
      r.hdr.bloomStrength = effects ? 0.3 : 0;
      r.hdr.autoExposure = effects;
      const samples = [];
      for (let i = 0; i < 30; i++) {
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
        if (i >= 10) samples.push(performance.now() - start);
      }
      samples.sort((a, b) => /** Computes the a - b result. */ a - b);
      timing.push({ effects, completionMedianMs: samples[10] });
    }
    const invalid = [];
    for (const [key, value] of [
      ["bloomStrength", -1],
      ["bloomThreshold", NaN],
      ["exposureKey", 0],
      ["adaptationSpeed", 101],
      ["frameDeltaSeconds", -1],
    ]) {
      try {
        r.hdr[key] = value;
      } catch {
        invalid.push(key);
      }
    }
    const validation = (await app.gpu.device.popErrorScope())?.message ?? null,
      old = r.resources;
    app.autoRecoverDevice = false;
    await app.recoverDevice();
    r = app.renderer;
    const recovery = {
      strength: r.hdr.bloomStrength,
      auto: r.hdr.autoExposure,
      curve: r.hdr.toneMapping,
    };
    r.hdr.frameDeltaSeconds = 1;
    await draw();
    const gpuErrors = [...app.gpu.errors];
    await app.dispose();
    return {
      filmic,
      autoOne,
      autoFour,
      frozen,
      compensation,
      odd,
      black,
      halo,
      restored: difference(noBloom, restored),
      before,
      after,
      modes,
      timing,
      invalid,
      validation,
      recovery,
      gpuErrors,
      oldLive: [old.stats.buffers, old.stats.textures],
      finalLive: [r.resources.stats.buffers, r.resources.stats.textures],
    };
  });
  /** Converts a linear reference value into an 8-bit sRGB display value. */
  const srgb = (linear) =>
    Math.round(
      (linear <= 0.0031308
        ? linear * 12.92
        : 1.055 * linear ** (1 / 2.4) - 0.055) * 255,
    );
  /** Evaluates the reference filmic tone curve for analytic pixel assertions. */
  const curve = (x) =>
    Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
  assert.ok(Math.abs(report.filmic - srgb(curve(0.18))) <= 1);
  for (const key of ["autoOne", "autoFour", "odd"])
    assert.ok(Math.abs(report[key] - srgb(0.18 / 1.18)) <= 1, key);
  assert.ok(report.frozen < report.autoOne);
  assert.ok(report.compensation > report.autoOne);
  assert.equal(report.black, 0);
  assert.ok(report.halo > 0);
  assert.equal(report.restored, 0);
  for (const mode of report.modes) assert.equal(mode.difference, 0, mode.mode);
  for (const key of [
    "pipelineCreations",
    "bufferCreations",
    "textureCreations",
    "shaderModules",
    "samplerCreations",
  ])
    assert.equal(report.before[key], report.after[key]);
  assert.equal(report.invalid.length, 5);
  assert.equal(report.validation, null);
  assert.deepEqual(report.recovery, {
    strength: 0.3,
    auto: true,
    curve: "reinhard",
  });
  assert.deepEqual(report.oldLive, [0, 0]);
  assert.deepEqual(report.finalLive, [0, 0]);
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/post-gpu.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    server.kill("SIGTERM");
  }
}
