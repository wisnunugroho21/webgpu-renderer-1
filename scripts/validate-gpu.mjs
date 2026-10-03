import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const server = spawn(
  "npm",
  [
    "run",
    process.env.RENDERER_PREVIEW ? "preview" : "dev",
    "--",
    "--port",
    "5173",
    "--strictPort",
  ],
  { stdio: "pipe" },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk;
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk;
});
let browser;
try {
  await mkdir("artifacts", { recursive: true });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try {
      if ((await fetch("http://127.0.0.1:5173")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 2,
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:5173");
  await page.waitForFunction(() => window.rendererApp?.frames >= 150, {
    timeout: 30000,
  });
  await page.setViewportSize({ width: 640, height: 480 });
  await page.waitForFunction(
    () =>
      window.rendererApp.canvas.width === 1280 &&
      window.rendererApp.canvas.height === 960,
  );
  const cameraCheck = await page.evaluate(() => {
    const app = window.rendererApp,
      renderer = app.renderer;
    // Complete the expected resize allocation before checking steady state.
    renderer.resize();
    const originalBuffer = renderer.frameBuffer;
    const statsBefore = { ...renderer.resources.stats };
    const createBuffer = app.gpu.device.createBuffer.bind(app.gpu.device);
    let creations = 0;
    app.gpu.device.createBuffer = (...args) => {
      creations++;
      return createBuffer(...args);
    };
    for (let i = 0; i < 100; i++) {
      renderer.camera.setPosition(3 + i * 0.01, 2, 5);
      const encoder = app.gpu.device.createCommandEncoder();
      renderer.encode(
        encoder,
        app.gpu.context.getCurrentTexture().createView(),
      );
      app.gpu.queue.submit([encoder.finish()]);
    }
    const movedMatrix = Array.from(renderer.camera.viewProjection);
    renderer.camera.setPosition(3, 2, 5);
    renderer.camera.update(4 / 3);
    // Mark dirty again so the restored camera is uploaded for the next frame.
    renderer.camera.setPosition(3, 2, 5);
    app.gpu.device.createBuffer = createBuffer;
    const statsAfter = { ...renderer.resources.stats };
    return {
      creations,
      statsBefore,
      statsAfter,
      sameBuffer: renderer.frameBuffer === originalBuffer,
      moved: movedMatrix.some(
        (v, i) => Math.abs(v - renderer.camera.viewProjection[i]) > 0.001,
      ),
    };
  });
  assert.equal(cameraCheck.creations, 0);
  assert.ok(cameraCheck.sameBuffer && cameraCheck.moved);
  assert.deepEqual(
    cameraCheck.statsBefore,
    cameraCheck.statsAfter,
    "steady-state moves must not construct persistent GPU resources",
  );
  const resourceBenchmark = await page.evaluate(() => {
    const r = window.rendererApp.renderer,
      d = r.pipelineDescriptor,
      count = 100;
    let start = performance.now();
    for (let i = 0; i < count; i++) r.gpu.device.createRenderPipeline(d);
    const uncachedMs = performance.now() - start;
    start = performance.now();
    for (let i = 0; i < count; i++)
      if (r.resources.pipelines.get(d) !== r.pipeline)
        throw new Error("Cache identity mismatch");
    return {
      count,
      uncachedMs,
      cachedMs: performance.now() - start,
      stats: { ...r.resources.stats },
    };
  });
  const dynamicBenchmark = await page.evaluate(() => {
    const r = window.rendererApp.renderer,
      count = 10000,
      data = new Float32Array(16);
    let start = performance.now();
    for (let i = 0; i < count; i++) {
      const buffer = r.gpu.device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      r.gpu.queue.writeBuffer(buffer, 0, data);
      buffer.destroy();
    }
    const individualMs = performance.now() - start,
      before = r.resources.stats.bufferCreations;
    start = performance.now();
    r.dynamic.beginFrame(0);
    for (let i = 0; i < count; i++)
      r.dynamic.write(r.dynamic.allocate(64, 16), data);
    r.dynamic.flush(r.gpu.queue);
    return {
      count,
      individualMs,
      sharedMs: performance.now() - start,
      sharedBufferCreations: r.resources.stats.bufferCreations - before,
      arenaBuffers: r.dynamic.buffers.length,
      uploadBytes: r.dynamic.uploadBytes,
    };
  });
  assert.equal(dynamicBenchmark.sharedBufferCreations, 0);
  assert.equal(dynamicBenchmark.arenaBuffers, 3);
  assert.equal(dynamicBenchmark.uploadBytes, 640000);
  const drawBenchmark = await page.evaluate(async () => {
    const app = window.rendererApp,
      r = app.renderer,
      w = app.world;
    app.stop();
    for (let i = 0; i < 10000; i++) {
      const e = i === 0 ? app.sceneEntity : w.create();
      w.transforms.add(e);
      w.meshes.set(e, 0, 0, 1 << 16);
      w.bounds.setSphere(e, 0, 0, 0, Math.sqrt(3));
      w.transforms.setPosition(
        e,
        ((i % 100) - 49.5) * 0.09,
        (Math.floor(i / 100) - 49.5) * 0.09,
        0,
      );
      w.transforms.setScale(e, 0.03, 0.03, 0.03);
    }
    app.transformSystem.update(w.transforms);
    app.extractor.extract(w, app.renderWorld);
    r.camera.setPosition(0, 0, 15);
    const resourceBefore = { ...r.resources.stats },
      results = {};
    for (const mode of ["individual", "sorted", "instanced", "instanced-bvh"]) {
      r.submissionMode = mode === "instanced-bvh" ? "instanced" : mode;
      r.visibilityMode = mode === "instanced-bvh" ? "bvh" : "linear";
      const times = [];
      let texture, buffer;
      for (let frame = 0; frame < 7; frame++) {
        texture = r.gpu.context.getCurrentTexture();
        const encoder = r.gpu.device.createCommandEncoder(),
          start = performance.now();
        r.encode(encoder, texture.createView());
        if (frame === 6) {
          const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
          buffer = r.gpu.device.createBuffer({
            size: bytesPerRow * texture.height,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
            texture.width,
            texture.height,
          ]);
        }
        r.gpu.queue.submit([encoder.finish()]);
        if (frame >= 2) times.push(performance.now() - start);
        // Benchmark-only synchronization keeps this stress test bounded.
        await r.gpu.queue.onSubmittedWorkDone();
      }
      const stats = { ...r.stats };
      await buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(buffer.getMappedRange());
      let hash = 2166136261;
      for (const value of bytes) hash = Math.imul(hash ^ value, 16777619) >>> 0;
      buffer.unmap();
      buffer.destroy();
      times.sort((a, b) => a - b);
      results[mode] = {
        medianCpuMs: times[2],
        samples: times,
        stats,
        imageHash: hash,
      };
    }
    return {
      objects: 10000,
      results,
      resourceBefore,
      resourceAfter: { ...r.resources.stats },
    };
  });
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
    const app = window.rendererApp;
    for (let e = 1; e < app.world.nextEntity; e++) app.world.destroy(e);
    app.world.transforms.setPosition(app.sceneEntity, 0, 0, 0);
    app.world.transforms.setScale(app.sceneEntity, 1, 1, 1);
    app.transformSystem.update(app.world.transforms);
    app.extractor.extract(app.world, app.renderWorld);
    app.renderer.camera.setPosition(3, 2, 5);
    app.renderer.submissionMode = "instanced";
    app.renderer.visibilityMode = "linear";
  });
  await page.screenshot({ path: "artifacts/cube.png" });
  const report = await page.evaluate(async () => {
    const app = window.rendererApp;
    app.stop();
    const gpu = app.gpu;
    gpu.device.pushErrorScope("validation");
    // Readback is confined to the regression harness, never the normal frame path.
    const texture = gpu.context.getCurrentTexture();
    const encoder = gpu.device.createCommandEncoder();
    app.renderer.encode(encoder, texture.createView());
    const buffer = gpu.device.createBuffer({
      size: 512,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow: 256 },
      [1, 1],
    );
    encoder.copyTextureToBuffer(
      {
        texture,
        origin: [Math.floor(texture.width / 2), Math.floor(texture.height / 2)],
      },
      { buffer, offset: 256, bytesPerRow: 256 },
      [1, 1],
    );
    gpu.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mappedBytes = new Uint8Array(buffer.getMappedRange());
    const pixel = Array.from(mappedBytes.slice(0, 4));
    const centerPixel = Array.from(mappedBytes.slice(256, 260));
    buffer.unmap();
    buffer.destroy();
    const materialChecks = {};
    for (const [name, material] of [
      ["tint", { baseColor: [1, 0, 1, 1] }],
      ["mask", { baseColor: [1, 1, 1, 0.1], alphaMode: "MASK" }],
      ["blend", { baseColor: [1, 1, 1, 0.5], alphaMode: "BLEND" }],
      ["offscreen", {}],
    ]) {
      app.materials.set(0, material);
      if (name === "offscreen") {
        app.world.transforms.setPosition(app.sceneEntity, 100, 0, 0);
        app.transformSystem.update(app.world.transforms);
        app.extractor.extract(app.world, app.renderWorld);
      }
      const target = gpu.context.getCurrentTexture(),
        commands = gpu.device.createCommandEncoder();
      app.renderer.encode(commands, target.createView());
      const readback = gpu.device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      commands.copyTextureToBuffer(
        {
          texture: target,
          origin: [Math.floor(target.width / 2), Math.floor(target.height / 2)],
        },
        { buffer: readback, bytesPerRow: 256 },
        [1, 1],
      );
      gpu.queue.submit([commands.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      materialChecks[name] = Array.from(
        new Uint8Array(readback.getMappedRange()).slice(0, 4),
      );
      readback.unmap();
      readback.destroy();
      if (name === "offscreen")
        materialChecks.offscreenStats = { ...app.renderer.stats };
    }
    app.world.transforms.setPosition(app.sceneEntity, 0, 0, 0);
    app.transformSystem.update(app.world.transforms);
    app.extractor.extract(app.world, app.renderWorld);
    app.materials.set(0, {});
    app.world.destroy(app.sceneEntity);
    await app.loadAsset(
      new URL("/regression/triangle.glb", location.href).href,
    );
    app.transformSystem.update(app.world.transforms);
    app.extractor.extract(app.world, app.renderWorld);
    app.renderer.camera.setPosition(0, 0, 5);
    const assetTexture = gpu.context.getCurrentTexture(),
      assetCommands = gpu.device.createCommandEncoder();
    app.renderer.encode(assetCommands, assetTexture.createView());
    const assetBuffer = gpu.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    assetCommands.copyTextureToBuffer(
      {
        texture: assetTexture,
        origin: [
          Math.floor(assetTexture.width / 2),
          Math.floor(assetTexture.height / 2),
        ],
      },
      { buffer: assetBuffer, bytesPerRow: 256 },
      [1, 1],
    );
    gpu.queue.submit([assetCommands.finish()]);
    await assetBuffer.mapAsync(GPUMapMode.READ);
    const assetPixel = Array.from(
      new Uint8Array(assetBuffer.getMappedRange()).slice(0, 4),
    );
    assetBuffer.unmap();
    assetBuffer.destroy();
    const validationError = await gpu.device.popErrorScope();
    const samples = Array.from(app.encodingTimes)
      .slice(20, Math.min(app.frames, 600))
      .sort((a, b) => a - b);
    const info = gpu.adapter.info;
    const report = {
      adapter: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
      },
      format: gpu.format,
      frames: app.frames,
      size: [app.canvas.width, app.canvas.height],
      pixel,
      centerPixel,
      materialChecks,
      assetPixel,
      errors: gpu.errors,
      validationError: validationError?.message ?? null,
      cpuEncodingMs: {
        median: samples[Math.floor(samples.length * 0.5)],
        p95: samples[Math.floor(samples.length * 0.95)],
      },
    };
    // Destroy simulates loss and verifies the application's lost-device callback.
    gpu.device.destroy();
    await gpu.device.lost;
    await new Promise((resolve) => setTimeout(resolve, 0));
    report.lossHandled =
      gpu.lost && app.status.textContent.includes("GPU device lost");
    return report;
  });
  assert.equal(report.validationError, null);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(pageErrors, []);
  const expected = report.format.startsWith("bgra")
    ? [36, 20, 10, 255]
    : [10, 20, 36, 255];
  report.pixel.forEach((value, i) =>
    assert.ok(
      Math.abs(value - expected[i]) <= 1,
      `clear pixel channel ${i}: ${value}`,
    ),
  );
  assert.deepEqual(
    report.centerPixel,
    report.format.startsWith("bgra")
      ? [255, 166, 51, 255]
      : [51, 166, 255, 255],
    "front cube face must be blue at center",
  );
  assert.deepEqual(
    report.materialChecks.tint,
    report.format.startsWith("bgra") ? [255, 0, 51, 255] : [51, 0, 255, 255],
  );
  assert.deepEqual(report.materialChecks.mask, expected);
  assert.deepEqual(report.materialChecks.offscreen, expected);
  assert.equal(report.materialChecks.offscreenStats.frustumRejected, 1);
  assert.equal(report.materialChecks.offscreenStats.drawCalls, 0);
  assert.deepEqual(
    report.assetPixel,
    report.format.startsWith("bgra")
      ? [255, 51, 178, 255]
      : [178, 51, 255, 255],
  );
  const blendExpected = report.format.startsWith("bgra")
    ? [146, 93, 31, 255]
    : [31, 93, 146, 255];
  report.materialChecks.blend.forEach((v, i) =>
    assert.ok(Math.abs(v - blendExpected[i]) <= 1, "alpha blending pixel"),
  );
  assert.ok(report.lossHandled, "device loss callback must update UI");
  report.cameraCheck = cameraCheck;
  report.resourceBenchmark = resourceBenchmark;
  report.dynamicBenchmark = dynamicBenchmark;
  report.drawBenchmark = drawBenchmark;
  await writeFile("artifacts/phase-13.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
