import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";
await mkdir("artifacts", { recursive: true });
const server = await startPreviewServer(5193, true);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on("pageerror", (error) =>
    /** Delegates this operation to errors.push. */ errors.push(error.message),
  );
  await page.goto("http://127.0.0.1:5193");
  await page.waitForFunction(
    () =>
      /** Evaluates the window.rendererApp?.frames >= 3 condition. */ window
        .rendererApp?.frames >= 3,
  );
  const report = await page.evaluate(async () => {
    // Builds a record containing layers, environment, gpu error, uncaptured errors.

    const app = window.rendererApp,
      r = app.renderer,
      w = app.world,
      device = app.gpu.device;
    app.stop();
    device.pushErrorScope("validation");
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
      return bytes;
    };
    /** Compares diagnostic pixel buffers and reports their differing values. */
    const difference = (a, b) => {
      let count = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
      return count;
    };
    w.destroy(app.sceneEntity);
    r.camera.setPosition(0, 0, 3);
    r.camera.setTarget(0, 0, 0);
    await app.loadAsset("/regression/crowd-combined.glb");
    const animator = app.animations.animators[0];
    animator.play();
    animator.currentTime = 0.7;
    for (const state of app.animations.morphStates) {
      state.weights.fill(0.02);
      state.dirty = true;
    }
    r.depthPrepass.enabled = true;
    r.shadows.enabled = true;
    w.lights.castShadow[app.defaultLightEntity] = 1;
    await draw();
    const base = await draw(),
      resources = { ...r.resources.stats };
    const layer = animator.addLayer({
      clip: 0,
      time: 0.2,
      weight: 1,
      mode: "override",
      playing: false,
    });
    const layered = await draw();
    layer.weight = 0;
    animator.update(0);
    const zero = await draw();
    layer.weight = 1;
    animator.update(0);
    const restoredLayer = await draw();
    animator.clearLayers();
    animator.currentTime = 0.2;
    const direct = await draw();
    animator.currentTime = 0.7;
    const restored = await draw();
    const layers = {
      activeDifference: difference(base, layered),
      zeroDifference: difference(base, zero),
      referenceDifference: difference(direct, restoredLayer),
      clearedDifference: difference(base, restored),
      resourcesBefore: resources,
      resourcesAfter: { ...r.resources.stats },
      jointUploadBytes: r.stats.jointUploadBytes,
      depthPasses: r.stats.depthPasses,
      shadowPasses: r.stats.shadowPasses,
    };
    animator.evaluationInterval = 1 / 30;
    animator.update(1 / 120);
    layers.rateHeldDifference = difference(restored, await draw());
    animator.update(1 / 40);
    layers.rateEvaluatedDifference = difference(restored, await draw());
    animator.evaluationInterval = 0;
    animator.currentTime = 0.7;
    /** Builds a record containing size, faces. */
    const cube = (size, color) => ({
      size,
      faces: Array.from({ length: 6 }, (_, face) => {
        // Returns pixels.

        const pixels = new Float32Array(size * size * 4),
          rgb = color(face);
        for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 1], i);
        return pixels;
      }),
    });
    const lut = new Float32Array(4 * 4 * 4);
    for (let i = 0; i < lut.length; i += 4) lut.set([0.8, 0.05, 0, 1], i);
    const constantEnvironment = {
      diffuse: cube(
        2,
        () => /** Returns the ordered values needed by this operation. */ [
          0.5, 0.5, 0.5,
        ],
      ),
      specular: [4, 2, 1].map((size) =>
        /** Delegates this operation to cube. */ cube(
          size,
          () => /** Returns the ordered values needed by this operation. */ [
            0.25, 0.25, 0.25,
          ],
        ),
      ),
      brdf: { size: 4, pixels: lut },
    };
    const material = app.renderWorld.materialId[0];
    app.materials.set(material, { metallic: 1, roughness: 1 });
    w.lights.intensity[app.defaultLightEntity] = 0;
    const off = await draw(),
      beforeEnvironment = { ...r.resources.stats };
    const installStart = performance.now();
    await r.setEnvironment(constantEnvironment);
    const installationMs = performance.now() - installStart;
    const enabled = await draw();
    const width = app.canvas.width,
      bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const centerOffset =
      Math.floor(app.canvas.height / 2) * bytesPerRow +
      Math.floor(width / 2) * 4;
    const center = Array.from(enabled.subarray(centerOffset, centerOffset + 3));
    const expected = Math.round(
      (1.055 * Math.pow(0.25 * (0.8 + 0.05), 1 / 2.4) - 0.055) * 255,
    );
    const analyticError = Math.max(
      ...center.map((value) =>
        /** Computes Math.abs(value - expected) without allocating intermediate vectors. */ Math.abs(
          value - expected,
        ),
      ),
    );
    const modeImages = [];
    for (const mode of [
      "individual",
      "sorted",
      "instanced",
      ...(r.gpuDraws.supported ? ["gpu-indirect"] : []),
    ]) {
      r.submissionMode = mode;
      const image = await draw();
      modeImages.push({ mode, differentBytes: difference(enabled, image) });
    }
    r.submissionMode = "instanced";
    r.environment.enabled = false;
    const disabled = await draw();
    r.environment.enabled = true;
    r.environment.intensity = 0;
    const dark = await draw();
    const darkCenter = Array.from(
      dark.subarray(centerOffset, centerOffset + 3),
    );
    r.environment.intensity = 1;
    const resumed = await draw();
    const warmResources = { ...r.resources.stats };
    let rejected = false;
    try {
      await r.setEnvironment({ ...constantEnvironment, specular: [] });
    } catch {
      rejected = true;
    }
    const afterFailure = await draw();
    const directional = {
      ...constantEnvironment,
      specular: [4, 2, 1].map((size, mip) =>
        /** Delegates this operation to cube. */ cube(size, (face) =>
          /** Selects the result according to mip === 0. */ mip === 0
            ? face === 4
              ? [0, 0, 1]
              : [1, 0, 0]
            : [0, 1, 0],
        ),
      ),
    };
    await r.setEnvironment(directional);
    app.materials.set(material, { metallic: 1, roughness: 0 });
    const smooth = await draw();
    r.environment.rotationY = Math.PI / 2;
    const rotated = await draw();
    r.environment.rotationY = 0;
    app.materials.set(material, { metallic: 1, roughness: 1 });
    const rough = await draw();
    /** Warms the workload and records CPU/completion/GPU timings outside the ordinary rendering path. */
    const measure = async (enabled) => {
      r.environment.enabled = enabled;
      const rows = [];
      for (let frame = 0; frame < 120; frame++) {
        const start = performance.now(),
          encoder = device.createCommandEncoder();
        r.encode(
          encoder,
          app.gpu.context
            .getCurrentTexture()
            .createView({ format: app.gpu.renderFormat }),
        );
        app.gpu.queue.submit([encoder.finish()]);
        const cpu = performance.now() - start;
        await app.gpu.queue.onSubmittedWorkDone();
        if (frame >= 60)
          rows.push({ cpu, completion: performance.now() - start });
      }
      /** Returns the middle sorted timing sample to summarize diagnostic measurements. */
      const median = (values) =>
        values.sort((a, b) => /** Computes the a - b result. */ a - b)[
          Math.floor(values.length / 2)
        ];
      return {
        cpuEncodingMs: median(rows.map((x) => /** Returns x cpu. */ x.cpu)),
        completionMs: median(
          rows.map((x) => /** Returns x completion. */ x.completion),
        ),
      };
    };
    const timingResources = { ...r.resources.stats };
    const timings = { off: await measure(false), on: await measure(true) };
    const afterWarm = { ...r.resources.stats };
    // Heavier fill workload: 31 enlarged transparent planes plus the animated surface.
    r.depthPrepass.enabled = false;
    r.shadows.enabled = false;
    app.materials.set(material, {
      metallic: 1,
      roughness: 0.5,
      alphaMode: "BLEND",
      baseColor: [1, 1, 1, 0.08],
    });
    const planes = [];
    for (let i = 0; i < 31; i++) {
      const entity = w.create();
      planes.push(entity);
      w.transforms.add(entity);
      w.transforms.setPosition(entity, 0, 0, -i * 0.001);
      w.transforms.setScale(entity, 4, 4, 4);
      w.meshes.set(entity, app.renderWorld.meshId[0], material);
      w.bounds.setSphere(entity, 0, 0, 0, Math.SQRT1_2);
    }
    await draw();
    const overdrawResourcesBefore = { ...r.resources.stats };
    const overdrawTimings = {
      off: await measure(false),
      on: await measure(true),
    };
    const overdrawResourcesAfter = { ...r.resources.stats };
    for (const entity of planes) w.destroy(entity);

    await r.setEnvironment(null);
    const clearedResources = { ...r.resources.stats };
    const environment = {
      installationMs,
      analyticError,
      darkCenter,
      center,
      expected,
      activeDifference: difference(off, enabled),
      disabledDifference: difference(off, disabled),
      resumedDifference: difference(enabled, resumed),
      failedInstallDifference: difference(enabled, afterFailure),
      rejected,
      zeroIntensityDifference: difference(enabled, dark),
      rotationDifference: difference(smooth, rotated),
      roughnessDifference: difference(smooth, rough),
      modeImages,
      timings,
      overdrawTimings,
      overdrawResourcesBefore,
      overdrawResourcesAfter,
      timingResources,
      beforeEnvironment,
      warmResources,
      afterWarm,
      clearedResources,
    };
    const gpuError = await device.popErrorScope();
    return {
      layers,
      environment,
      gpuError: gpuError?.message ?? null,
      uncapturedErrors: [...app.gpu.errors],
    };
  });
  assert.equal(report.layers.zeroDifference, 0);
  assert.equal(report.layers.referenceDifference, 0);
  assert.equal(report.layers.clearedDifference, 0);
  assert.ok(report.layers.activeDifference > 0);
  assert.equal(report.layers.jointUploadBytes, 4096);
  assert.ok(report.layers.depthPasses > 0);
  assert.ok(report.layers.shadowPasses > 0);
  for (const key of [
    "bufferCreations",
    "textureCreations",
    "shaderModules",
    "pipelineCreations",
    "samplerCreations",
  ])
    assert.equal(
      report.layers.resourcesBefore[key],
      report.layers.resourcesAfter[key],
    );
  assert.ok(
    report.environment.analyticError <= 1,
    "Constant HDR split-sum analytic reference",
  );
  assert.deepEqual(report.environment.darkCenter, [0, 0, 0]);
  assert.ok(report.environment.activeDifference > 0);
  assert.equal(report.environment.disabledDifference, 0);
  assert.equal(report.environment.resumedDifference, 0);
  assert.equal(report.environment.failedInstallDifference, 0);
  assert.equal(report.environment.rejected, true);
  assert.ok(report.environment.zeroIntensityDifference > 0);
  assert.ok(report.environment.rotationDifference > 0);
  assert.ok(report.environment.roughnessDifference > 0);
  for (const mode of report.environment.modeImages)
    assert.equal(mode.differentBytes, 0, mode.mode);
  for (const key of ["buffers", "textures", "bufferBytes"])
    assert.equal(
      report.environment.beforeEnvironment[key],
      report.environment.clearedResources[key],
    );
  for (const key of [
    "pipelineCreations",
    "shaderModules",
    "samplerCreations",
    "bufferCreations",
    "textureCreations",
  ])
    assert.equal(
      report.environment.timingResources[key],
      report.environment.afterWarm[key],
    );
  for (const key of [
    "pipelineCreations",
    "shaderModules",
    "samplerCreations",
    "bufferCreations",
    "textureCreations",
  ])
    assert.equal(
      report.environment.overdrawResourcesBefore[key],
      report.environment.overdrawResourcesAfter[key],
    );
  assert.equal(report.layers.rateHeldDifference, 0);
  assert.ok(report.layers.rateEvaluatedDifference > 0);
  assert.equal(report.gpuError, null);
  assert.deepEqual(report.uncapturedErrors, []);
  assert.deepEqual(errors, []);
  await page.goto("http://127.0.0.1:5193/?example=lighting");
  await page.waitForFunction(
    () =>
      /** Returns window environment demo ready. */ window.environmentDemoReady,
  );
  const readyFrame = await page.evaluate(
    () => /** Returns window renderer app frames. */ window.rendererApp.frames,
  );
  await page.waitForFunction(
    (frame) =>
      /** Evaluates the window.rendererApp.frames >= frame + 3 condition. */ window
        .rendererApp.frames >=
      frame + 3,
    readyFrame,
  );
  const demoResources = await page.evaluate(
    () => /** Returns an empty fixture handle for a controlled test dependency. */ ({
      ...window.rendererApp.renderer.resources.stats,
    }),
  );
  await page.screenshot({ path: "artifacts/environment-lighting.png" });
  await page.locator("canvas").click();
  await page.keyboard.press("e");
  await page.waitForFunction(
    () =>
      /** Returns !window.rendererApp.renderer.environment.enabled. */ !window
        .rendererApp.renderer.environment.enabled,
  );
  await page.keyboard.press("e");
  await page.waitForFunction(
    () =>
      /** Returns window renderer app renderer environment enabled. */ window
        .rendererApp.renderer.environment.enabled,
  );
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(
    () =>
      /** Evaluates the window.rendererApp.renderer.environment.rotationY > 0.1 condition. */ window
        .rendererApp.renderer.environment.rotationY > 0.1,
  );
  await page.keyboard.up("ArrowRight");
  report.demo = await page.evaluate(
    () => /** Builds a record containing resources, rotation, gpu errors. */ ({
      resources: { ...window.rendererApp.renderer.resources.stats },
      rotation: window.rendererApp.renderer.environment.rotationY,
      gpuErrors: [...window.rendererApp.gpu.errors],
    }),
  );
  for (const key of [
    "pipelineCreations",
    "shaderModules",
    "samplerCreations",
    "bufferCreations",
    "textureCreations",
  ])
    assert.equal(demoResources[key], report.demo.resources[key]);
  assert.deepEqual(report.demo.gpuErrors, []);
  assert.deepEqual(errors, []);
  report.pageErrors = errors;
  await writeFile(
    "artifacts/scene-features.json",
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
