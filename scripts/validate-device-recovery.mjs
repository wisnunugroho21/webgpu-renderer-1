import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";
await mkdir("artifacts", { recursive: true });
const server = await startPreviewServer(5195, true);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5195");
  await page.waitForFunction(() => window.rendererApp?.frames >= 3);
  const report = await page.evaluate(async () => {
    const app = window.rendererApp;
    app.stop();
    app.autoRecoverDevice = false;
    await app.loadAssetHandles("/regression/pbr.glb");
    const instance = await app.instantiateAsset(
      "/regression/crowd-combined.glb",
    );
    const nodes = instance.nodes;
    const animator = app.animations.animators[0];
    animator.play();
    animator.currentTime = 0.7;
    app.world.destroy(app.sceneEntity);
    app.renderer.hdr.enabled = true;
    app.renderer.hdr.exposure = 0.5;
    const data = {
      diffuse: {
        size: 1,
        faces: Array.from(
          { length: 6 },
          () => new Float32Array([0.5, 0.5, 0.5, 1]),
        ),
      },
      specular: [
        {
          size: 1,
          faces: Array.from(
            { length: 6 },
            () => new Float32Array([0.25, 0.25, 0.25, 1]),
          ),
        },
      ],
      brdf: { size: 1, pixels: new Float32Array([0.8, 0.05, 0, 1]) },
    };
    await app.renderer.setEnvironment(data);
    for (const state of app.animations.morphStates) {
      state.weights.fill(0.05);
      state.dirty = true;
    }
    const draw = async () => {
      const r = app.renderer,
        w = app.world,
        device = app.gpu.device;
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
      const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256,
        buffer = device.createBuffer({
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
    const before = await draw(),
      cycles = [],
      entityCount = app.world.count;
    for (let i = 0; i < 3; i++) {
      const old = app.renderer,
        oldGPU = app.gpu,
        ids = app.world.nextEntity;
      if (i === 0)
        old.textures.groups[123] = oldGPU.device.createBindGroup({
          layout: oldGPU.device.createBindGroupLayout({ entries: [] }),
          entries: [],
        });
      oldGPU.device.destroy();
      await oldGPU.device.lost;
      if (i === 0) {
        let failed = false;
        try {
          await app.recoverDevice();
        } catch (error) {
          failed = String(error).includes("custom GPU group");
        }
        if (!failed || app.deviceState !== "failed")
          throw new Error("Failed recovery did not retain retry state");
        delete old.textures.groups[123];
      }
      const start = performance.now(),
        one = app.recoverDevice(),
        two = app.recoverDevice();
      if (one !== two)
        throw new Error("Concurrent recovery duplicated operation");
      await one;
      const ms = performance.now() - start,
        after = await draw();
      let differingBytes = 0;
      for (let j = 0; j < before.length; j++)
        if (before[j] !== after[j]) differingBytes++;
      if (
        app.world.count !== entityCount ||
        app.world.nextEntity !== ids ||
        nodes.some((h) => app.world.resolve(h) === null)
      )
        throw new Error("Recovery changed ECS identities");
      if (animator.currentTime !== 0.7)
        throw new Error("Recovery advanced animation");
      if (old.resources.stats.buffers || old.resources.stats.textures)
        throw new Error("Old device ownership leak");
      const resources = { ...app.renderer.resources.stats };
      await draw();
      await draw();
      const warm = { ...app.renderer.resources.stats };
      cycles.push({
        ms,
        differingBytes,
        resources,
        warm,
        oldBuffers: old.resources.stats.buffers,
        oldTextures: old.resources.stats.textures,
        state: app.deviceState,
      });
    }
    // Automatic recovery resumes a running loop, while manual recovery above remained paused.
    app.autoRecoverDevice = true;
    app.resume();
    const old = app.gpu;
    old.device.destroy();
    await old.device.lost;
    for (
      let i = 0;
      i < 200 && (app.gpu === old || app.deviceState !== "ready");
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    if (app.gpu === old || app.deviceState !== "ready")
      throw new Error("Automatic recovery failed");
    const frames = app.frames;
    await new Promise((r) => setTimeout(r, 100));
    if (app.frames <= frames) throw new Error("Recovered loop did not resume");
    app.stop();
    if (instance.disposed || instance.animator !== animator)
      throw new Error("Recovery lost scene-instance ownership");
    await instance.dispose();
    await app.unloadAsset("/regression/crowd-combined.glb");
    if (nodes.some((h) => app.world.resolve(h) !== null))
      throw new Error("Recovered asset did not unload");
    const gpuErrors = [...app.gpu.errors];
    await app.dispose();
    return {
      cycles,
      failedRetry: true,
      automatic: true,
      unload: true,
      gpuErrors,
      buffers: app.renderer.resources.stats.buffers,
      textures: app.renderer.resources.stats.textures,
    };
  });
  for (const cycle of report.cycles) {
    assert.equal(cycle.differingBytes, 0);
    assert.deepEqual(cycle.resources, cycle.warm);
    assert.equal(cycle.state, "ready");
  }
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(errors, []);
  assert.equal(report.buffers, 0);
  assert.equal(report.textures, 0);
  await writeFile(
    "artifacts/device-recovery.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
