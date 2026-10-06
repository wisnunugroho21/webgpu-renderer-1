import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { launchValidationBrowser } from "./gpu/validation-browser.mjs";
import { startPreviewServer } from "./gpu/preview-server.mjs";
const server = await startPreviewServer(5218, true);
let browser;
try {
  browser = await launchValidationBrowser();
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.goto("http://127.0.0.1:5218");
  await page.waitForFunction(() => {
    // Wait for application/device setup before the isolated diagnostic scenario.
    return window.rendererApp?.frames >= 3;
  });
  const report = await page.evaluate(async () => {
    // Fences and readbacks are confined to validation, never temporal production paths.
    const app = window.rendererApp;
    app.stop();
    const w = app.world,
      errors = [];
    const watch = () => {
      // Preserve validation errors across recovery devices.
      app.gpu.device.addEventListener("uncapturederror", (event) => {
        // Record asynchronous GPU scope failures without hiding browser exceptions.
        errors.push(event.error.message);
      });
    };
    watch();
    app.renderer.camera.setPosition(0, 0, 5);
    app.renderer.camera.setTarget(0, 0, 0);
    app.renderer.camera.setOrthographic({ height: 4, near: 0.1, far: 100 });
    w.transforms.setRotation(app.sceneEntity, 0, 0, 0, 1);
    w.transforms.setPosition(app.sceneEntity, 0, 0, 0);
    let deform;
    const draw = async (motion = false) => {
      // Submit one production frame and read either presented pixels or the diagnostic motion attachment.
      app.transformSystem.update(w.transforms);
      app.extractor.extract(
        w,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
      deform?.(app.renderWorld);
      const r = app.renderer,
        d = app.gpu.device,
        texture = app.gpu.context.getCurrentTexture(),
        encoder = d.createCommandEncoder(),
        start = performance.now();
      r.encode(encoder, texture.createView({ format: app.gpu.renderFormat }));
      const cpu = performance.now() - start;
      const source = motion ? r.taa.motionTexture : texture,
        bytesPerPixel = motion ? 16 : 4,
        bytesPerRow = Math.ceil((source.width * bytesPerPixel) / 256) * 256;
      const buffer = d.createBuffer({
        size: bytesPerRow * source.height,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      encoder.copyTextureToBuffer(
        { texture: source },
        { buffer, bytesPerRow },
        [source.width, source.height],
      );
      app.gpu.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(buffer.getMappedRange()).slice();
      const offset =
        Math.floor(source.height / 2) * bytesPerRow +
        Math.floor(source.width / 2) * bytesPerPixel;
      const center = motion
        ? Array.from(new Float32Array(bytes.buffer, offset, 4))
        : Array.from(bytes.slice(offset, offset + 4));
      buffer.unmap();
      buffer.destroy();
      return { bytes, center, cpu, completion: performance.now() - start };
    };
    const difference = (a, b) => {
      // Count exact stored pixel differences for mode/recovery comparisons.
      let count = 0;
      for (let i = 0; i < a.length; i++) count += Number(a[i] !== b[i]);
      return count;
    };
    const baseline = await draw();
    app.renderer.taa.jitter = false;
    app.renderer.antialiasing = "taa";
    const first = await draw();
    if (difference(baseline.bytes, first.bytes))
      throw new Error("Initial TAA frame differs from linear scene reference");
    const warm = { ...app.renderer.resources.stats };
    await draw();
    const stationary = await draw(true);
    if (app.renderer.stats.temporalUploadBytes !== 304)
      throw new Error("Stationary TAA reuploaded unchanged object poses");
    if (Math.abs(stationary.center[0]) > 1e-6 || stationary.center[3] !== 1)
      throw new Error("Stationary motion is invalid");
    w.transforms.setPosition(app.sceneEntity, 0.2, 0, 0);
    const moving = await draw(true);
    if (
      Math.abs(moving.center[0] - 0.0375) > 0.00001 ||
      Math.abs(moving.center[1]) > 0.00001
    )
      throw new Error(
        "Rigid object velocity is incorrect: " + JSON.stringify(moving.center),
      );
    if (JSON.stringify(warm) !== JSON.stringify(app.renderer.resources.stats))
      throw new Error("Warm temporal frame created resources");
    app.renderer.camera.setPosition(0.2, 0, 5);
    app.renderer.camera.setTarget(0.2, 0, 0);
    const cameraMotion = await draw(true);
    if (Math.abs(cameraMotion.center[0] + 0.0375) > 0.00001)
      throw new Error("Camera velocity is incorrect");
    app.renderer.camera.setPosition(0, 0, 5);
    app.renderer.camera.setTarget(0, 0, 0);
    await draw();
    app.gpu.canvas.width = 320;
    app.gpu.canvas.height = 240;
    const resized = await draw(true);
    if (resized.center[3] !== 0)
      throw new Error("Resize reused incompatible temporal history");
    app.gpu.canvas.width = 640;
    app.gpu.canvas.height = 480;
    await draw();
    const timings = [];
    for (let i = 0; i < 30; i++) {
      const sample = await draw();
      timings.push({ cpuMs: sample.cpu, completionMs: sample.completion });
    }
    const settled = await draw();
    app.renderer.taa.reset();
    const cut = await draw();
    if (difference(settled.bytes, cut.bytes))
      throw new Error("Explicit history reset changed static scene");
    app.particles.enabled = true;
    app.particles.burst(
      {
        position: [0, 0, 1],
        velocity: [0, 0, 0],
        velocitySpread: [0, 0, 0],
        lifetime: [10, 10],
        startColor: [1, 0, 0, 0.5],
        endColor: [1, 0, 0, 0.5],
        startSize: 1,
        endSize: 1,
        fadeOut: 0,
        shape: "square",
      },
      1,
    );
    const transparent = await draw();
    app.renderer.antialiasing = "none";
    const noHistory = await draw();
    if (difference(transparent.bytes, noHistory.bytes))
      throw new Error("Reactive transparency history left ghosts");
    app.renderer.antialiasing = "taa";
    app.renderer.taa.jitter = false;
    await draw();
    const reference = await draw();
    await app.recoverDevice();
    app.stop();
    watch();
    const recovered = await draw();
    if (
      app.renderer.antialiasing !== "taa" ||
      difference(reference.bytes, recovered.bytes)
    )
      throw new Error("Temporal recovery changed settings or pixels");
    app.renderer.taa.jitter = true;
    for (let i = 0; i < 16; i++) await draw();
    app.particles.clear();
    app.particles.enabled = false;
    w.transforms.setRotation(
      app.sceneEntity,
      0,
      0,
      Math.sin(0.13),
      Math.cos(0.13),
    );
    app.renderer.taa.jitter = true;
    app.renderer.taa.feedback = 0.9;
    app.renderer.taa.reset();
    for (let i = 0; i < 16; i++) await draw();
    const instability = async () => {
      // Compare successive jittered presentations using total byte variation in this benchmark only.
      let prior = (await draw()).bytes,
        total = 0;
      for (let frame = 0; frame < 8; frame++) {
        const next = (await draw()).bytes;
        for (let i = 0; i < next.length; i++)
          total += Math.abs(next[i] - prior[i]);
        prior = next;
      }
      return total;
    };
    const temporalVariation = await instability();
    const probe = await draw(true);
    app.renderer.taa.feedback = 0;
    const rawVariation = await instability();
    if (rawVariation === 0 || temporalVariation >= rawVariation)
      throw new Error(
        "Temporal accumulation did not reduce jitter variation: " +
          JSON.stringify({
            temporalVariation,
            rawVariation,
            motion: probe.center,
            history: app.renderer.taa.historyValid,
            stamp: app.renderer.taa.stamp,
          }),
      );
    app.renderer.taa.feedback = 0.9;
    w.transforms.setRotation(app.sceneEntity, 0, 0, 0, 1);
    app.renderer.taa.jitter = false;
    app.renderer.taa.reset();
    w.transforms.setPosition(app.sceneEntity, 0, 0, 0);
    const originalMesh = w.meshes.meshId[app.sceneEntity];
    const repeat = (v) => {
      // Pack identical per-vertex attributes for the analytic animation reference.
      return new Float32Array([...v, ...v, ...v]);
    };
    const mesh = app.renderer.meshes.upload({
      mode: 4,
      material: w.meshes.materialId[app.sceneEntity],
      indices: new Uint32Array([0, 1, 2]),
      targets: [{ POSITION: repeat([0.2, 0, 0]) }],
      attributes: {
        POSITION: new Float32Array([-2, -2, 0, 2, -2, 0, 0, 2, 0]),
        NORMAL: repeat([0, 0, 1]),
        JOINTS_0: repeat([0, 0, 0, 0]),
        WEIGHTS_0: repeat([1, 0, 0, 0]),
      },
    });
    w.meshes.meshId[app.sceneEntity] = mesh;
    let jointX = 0,
      morphWeight = 0;
    deform = (rw) => {
      // Drive shared palettes directly after extraction to isolate exact GPU motion arithmetic.
      rw.jointCount = 1;
      rw.jointMatrices.fill(0, 0, 16);
      rw.jointMatrices[0] =
        rw.jointMatrices[5] =
        rw.jointMatrices[10] =
        rw.jointMatrices[15] =
          1;
      rw.jointMatrices[12] = jointX;
      rw.jointDirty[0] = 1;
      rw.morphWeightCount = 1;
      rw.morphWeights[0] = morphWeight;
      rw.morphDirty[0] = 1;
      rw.jointOffset[0] = rw.morphOffset[0] = 0;
      rw.jointCounts[0] = rw.morphCounts[0] = 1;
      rw.skinInstanceId[0] = rw.morphStateId[0] = 999;
    };
    await draw(true);
    await draw(true);
    jointX = 0.4;
    morphWeight = 1;
    const animated = await draw(true);
    if (
      Math.abs(animated.center[0] - 0.1125) > 0.00001 ||
      animated.center[3] !== 1
    )
      throw new Error(
        "Morph/skin temporal velocity is incorrect: " +
          JSON.stringify(animated.center),
      );
    deform = undefined;
    w.meshes.meshId[app.sceneEntity] = originalMesh;
    const population = [];
    for (let i = 0; i < 1000; i++) {
      const entity = w.create();
      w.transforms.add(entity);
      w.transforms.setPosition(
        entity,
        ((i % 40) - 20) * 0.08,
        (Math.floor(i / 40) - 12) * 0.08,
        -1,
      );
      w.transforms.setScale(entity, 0.02, 0.02, 0.02);
      w.meshes.set(entity, originalMesh, w.meshes.materialId[app.sceneEntity]);
      w.bounds.setAABB(entity, [-1, -1, -1], [1, 1, 1]);
      population.push(entity);
    }
    const populationTimings = [];
    for (const mode of ["none", "taa"]) {
      app.renderer.antialiasing = mode;
      app.renderer.taa.jitter = false;
      for (let i = 0; i < 4; i++) await draw();
      const before = { ...app.renderer.resources.stats },
        samples = [];
      for (let i = 0; i < 30; i++) {
        const sample = await draw();
        samples.push({ cpuMs: sample.cpu, completionMs: sample.completion });
      }
      if (
        JSON.stringify(before) !== JSON.stringify(app.renderer.resources.stats)
      )
        throw new Error(
          "Temporal population benchmark allocated warm GPU resources",
        );
      populationTimings.push({
        mode,
        count: 1001,
        motionDraws: app.renderer.taa.drawCalls,
        uploadBytes: app.renderer.stats.temporalUploadBytes,
        samples,
      });
    }
    for (const entity of population) w.destroy(entity);
    app.renderer.antialiasing = "none";
    const resources = app.renderer.resources;
    await app.dispose();
    return {
      populationTimings,
      temporalVariation,
      rawVariation,
      cameraMotion: cameraMotion.center,
      animated: animated.center,
      stationary: stationary.center,
      moving: moving.center,
      initialDifference: difference(baseline.bytes, first.bytes),
      recoveryDifference: difference(reference.bytes, recovered.bytes),
      timings,
      errors,
      finalBuffers: resources.stats.buffers,
      finalTextures: resources.stats.textures,
    };
  });
  assert.deepEqual(report.errors, []);
  assert.equal(report.finalBuffers, 0);
  assert.equal(report.finalTextures, 0);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/temporal.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    server.kill("SIGTERM");
  }
}
