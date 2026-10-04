import { NodeIO } from "@gltf-transform/core";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";

await mkdir("artifacts", { recursive: true });
// The second primitive intentionally fails in GPU preparation after a valid first upload.
const io = new NodeIO(),
  document = await io.read("public/regression/skinned.glb");
const mesh = document.getRoot().listMeshes()[0],
  primitive = mesh.listPrimitives()[0];
mesh.addPrimitive(
  primitive
    .clone()
    .setAttribute("JOINTS_2", primitive.getAttribute("JOINTS_0"))
    .setAttribute("WEIGHTS_2", primitive.getAttribute("WEIGHTS_0")),
);
const invalid = await io.writeBinary(document);
const server = await startPreviewServer(5191, true);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on("pageerror", (error) =>
    /** Delegates this operation to errors.push. */ errors.push(error.message),
  );
  await page.route("**/lifecycle-invalid.glb", (route) =>
    /** Delegates this operation to route.fulfill. */ route.fulfill({
      body: Buffer.from(invalid),
      contentType: "model/gltf-binary",
    }),
  );
  await page.goto("http://127.0.0.1:5191");
  await page.waitForFunction(
    () =>
      /** Evaluates the window.rendererApp?.frames >= 10 condition. */ window
        .rendererApp?.frames >= 10,
  );
  const report = await page.evaluate(async () => {
    // Builds a record containing individual, baseline, baseline hash, failure, after failure, shared textures.

    const app = window.rendererApp,
      r = app.renderer;
    app.stop();
    await app.gpu.queue.onSubmittedWorkDone();
    /** Copies live resource/cache counters for leak and steady-state allocation comparisons. */
    const snapshot = () => ({
      buffers: r.resources.stats.buffers,
      bufferBytes: r.resources.stats.bufferBytes,
      textures: r.resources.stats.textures,
      textureCache: r.textures.cache.size,
      materials: app.materials.alive.reduce(
        (sum, alive) => /** Computes the sum + alive result. */ sum + alive,
        0,
      ),
      meshCount: r.meshes.entries.filter(Boolean).length,
      deltas: r.morphDeltas.count,
      joints: app.skeletons.jointCount,
      skeletons: app.skeletons.instances.length,
      skeletonAssets: app.skeletons.assets.length,
      morphWeights: app.animations.morphPool.count,
      morphStates: app.animations.morphStates.length,
      animators: app.animations.animators.length,
      entities: app.world.count,
      renderables: app.renderWorld.count,
    });
    /** Prepares the current scene, submits GPU work and reads pixels only for this diagnostic scenario. */
    const draw = async () => {
      app.transformSystem.update(app.world.transforms);
      app.skeletonSystem.update(app.world, app.skeletons);
      app.animatedBounds.update(
        app.world,
        r.meshes,
        app.skeletons,
        app.animations.morphPool,
      );
      app.extractor.extract(
        app.world,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
      const texture = app.gpu.context.getCurrentTexture(),
        encoder = app.gpu.device.createCommandEncoder();
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
      let hash = 2166136261;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      return hash;
    };
    const baselineHash = await draw(),
      baseline = snapshot();
    // Per-instance despawn keeps sibling playback, pixels and GPU ownership intact.
    const instanceURL = "/regression/skinned.glb?individual";
    const firstInstance = await app.instantiateAsset(instanceURL);
    const secondInstance = await app.instantiateAsset(instanceURL);
    firstInstance.animator.play();
    secondInstance.animator.play();
    firstInstance.animator.currentTime = 0.25;
    secondInstance.animator.currentTime = 0.25;
    const bothHash = await draw(),
      bothResident = snapshot();
    const disposedStart = performance.now();
    await firstInstance.dispose();
    const disposeMs = performance.now() - disposedStart;
    const remainingHash = await draw(),
      remainingResident = snapshot();
    const highWater = app.world.nextEntity;
    const despawnCycles = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      const instance = await app.instantiateAsset(instanceURL);
      await instance.dispose();
      despawnCycles.push(performance.now() - start);
    }
    const individual = {
      disposeMs,
      despawnCycles,
      bothHash,
      remainingHash,
      sameBuffers: bothResident.buffers === remainingResident.buffers,
      sameTextures: bothResident.textures === remainingResident.textures,
      sameHighWater: app.world.nextEntity === highWater,
      references: app.assetLoader.get(instanceURL).references,
      survivor: !secondInstance.disposed && secondInstance.animator.playing,
    };
    await app.unloadAsset(instanceURL);
    individual.invalidated = secondInstance.disposed;
    await secondInstance.dispose();
    let failure;
    try {
      await app.loadAsset("/lifecycle-invalid.glb");
    } catch (error) {
      failure = error.message;
    }
    const afterFailure = snapshot();
    await app.unloadAsset("/lifecycle-invalid.glb");
    const a = "/regression/skinned.glb?lifecycle-a",
      b = "/regression/skinned.glb?lifecycle-b";
    await Promise.all([app.loadAsset(a), app.loadAsset(a)]);
    await app.loadAsset(b);
    app.animations.animators[2].play();
    app.animations.animators[2].currentTime = 0.25;
    const surviving = app.animations.animators[2],
      skeleton = app.skeletons.instances[4],
      paletteOffset = skeleton.jointOffset;
    const sharedTextures = r.resources.stats.textures;
    await app.unloadAsset(a);
    const afterA = snapshot(),
      survivorHash = await draw();
    const survivorIntact =
      app.animations.animators[0] === surviving &&
      skeleton.jointOffset === paletteOffset &&
      app.world.alive[skeleton.meshEntity] === 1;
    await app.unloadAsset(b);
    const afterBoth = snapshot(),
      unloadedHash = await draw();
    const cycles = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await app.loadAsset(a);
      const loadMs = performance.now() - start,
        hash = await draw();
      const unloadStart = performance.now();
      await app.unloadAsset(a);
      cycles.push({
        loadMs,
        unloadMs: performance.now() - unloadStart,
        hash,
        resident: snapshot(),
      });
    }
    await app.assetLoader.setCacheBudget({
      maxRecords: 1,
      maxDecodedBytes: 4096,
    });
    await app.assetLoader.load("/regression/triangle.glb?cache-a");
    await app.assetLoader.load("/regression/triangle.glb?cache-b");
    const cache = {
      records: app.assetLoader.records.size,
      bytes: app.assetLoader.cachedDecodedBytes,
      urls: Array.from(app.assetLoader.records.keys()),
    };
    await app.assetLoader.setCacheBudget({ maxRecords: 0, maxDecodedBytes: 0 });
    return {
      individual,
      baseline,
      baselineHash,
      failure,
      afterFailure,
      sharedTextures,
      afterA,
      afterBoth,
      survivorIntact,
      survivorHash,
      unloadedHash,
      cycles,
      cache,
      final: snapshot(),
      errors: app.gpu.errors,
      records: app.assetLoader.records.size,
    };
  });
  assert.equal(report.individual.bothHash, report.individual.remainingHash);
  assert.equal(report.individual.sameBuffers, true);
  assert.equal(report.individual.sameTextures, true);
  assert.equal(report.individual.sameHighWater, true);
  assert.equal(report.individual.references, 1);
  assert.equal(report.individual.survivor, true);
  assert.equal(report.individual.invalidated, true);
  assert.match(report.failure, /More than eight/);
  assert.deepEqual(report.afterFailure, report.baseline);
  assert.equal(report.survivorIntact, true);
  assert.equal(report.afterA.textures, report.sharedTextures);
  assert.equal(report.afterA.animators, 1);
  assert.equal(report.afterA.skeletons, 2);
  assert.deepEqual(report.afterBoth, report.baseline);
  assert.equal(report.unloadedHash, report.baselineHash);
  for (const cycle of report.cycles)
    assert.deepEqual(cycle.resident, report.baseline);
  assert.equal(
    new Set(report.cycles.map((cycle) => /** Returns cycle hash. */ cycle.hash))
      .size,
    1,
  );
  assert.equal(report.cache.records, 1);
  assert.match(report.cache.urls[0], /cache-b/);
  assert.deepEqual(report.final, report.baseline);
  assert.equal(report.records, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(errors, []);
  let intercepted;
  const requested = new Promise((resolve) => {
    // Updates intercepted for this callback.

    intercepted = resolve;
  });
  let heldRoute;
  await page.route("**/lifecycle-cancel.glb", (route) => {
    // Applies intercepted to the current callback state.

    heldRoute = route;
    intercepted();
  });
  await page.evaluate(() => {
    // Applies app.loadAsset("/lifecycle-cancel.glb").then, app.loadAsset to the current callback state.

    const app = window.rendererApp;
    window.lifecycleCancelled = app.loadAsset("/lifecycle-cancel.glb").then(
      () =>
        /** Continues validate-asset-lifecycle.mjs after the preceding asynchronous operation succeeds. */ "unexpected success",
      (error) =>
        /** Continues validate-asset-lifecycle.mjs after the preceding asynchronous operation succeeds. */ error.name,
    );
  });
  await requested;
  report.cancellation = await page.evaluate(async () => {
    // Builds a record containing cancelled, error, records, entities.

    const app = window.rendererApp;
    const cancelled = app.cancelAssetLoad("/lifecycle-cancel.glb");
    const error = await window.lifecycleCancelled;
    await app.unloadAsset("/lifecycle-cancel.glb");
    return {
      cancelled,
      error,
      records: app.assetLoader.records.size,
      entities: app.world.count,
    };
  });
  await heldRoute.abort().catch(() => {
    // Intentionally performs no work at this optional callback boundary.
  });
  assert.equal(report.cancellation.cancelled, true);
  assert.equal(report.cancellation.error, "AbortError");
  assert.equal(report.cancellation.records, 0);
  assert.equal(report.cancellation.entities, report.baseline.entities);
  assert.deepEqual(errors, []);
  report.handles = await page.evaluate(async () => {
    // Builds a record containing cycles, first high water, final high water, entities, errors.

    const app = window.rendererApp,
      world = app.world,
      cycles = [];
    let stale, firstHighWater;
    for (let i = 0; i < 30; i++) {
      const start = performance.now(),
        handles = await app.loadAssetHandles("/regression/crowd-combined.glb");
      if (!stale) stale = handles[0];
      if (firstHighWater === undefined) firstHighWater = world.nextEntity;
      if (world.nextEntity !== firstHighWater)
        throw new Error("Handle load exhausted fresh slots");
      app.transformSystem.update(world.transforms);
      app.skeletonSystem.update(world, app.skeletons);
      app.extractor.extract(
        world,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
      const encoder = app.gpu.device.createCommandEncoder();
      app.renderer.encode(
        encoder,
        app.gpu.context
          .getCurrentTexture()
          .createView({ format: app.gpu.renderFormat }),
      );
      app.gpu.queue.submit([encoder.finish()]);
      await app.gpu.queue.onSubmittedWorkDone();
      if (i && world.resolve(stale) !== null)
        throw new Error("Stale asset handle revived");
      world.destroy(stale);
      if (
        i &&
        handles.some(
          (h) =>
            /** Evaluates the world.resolve(h) === null condition. */ world.resolve(
              h,
            ) === null,
        )
      )
        throw new Error("Stale destruction hit replacement");
      await app.unloadAsset("/regression/crowd-combined.glb");
      if (
        handles.some(
          (h) =>
            /** Evaluates the world.resolve(h) !== null condition. */ world.resolve(
              h,
            ) !== null,
        )
      )
        throw new Error("Unloaded asset handle still alive");
      cycles.push(performance.now() - start);
    }
    return {
      cycles,
      firstHighWater,
      finalHighWater: world.nextEntity,
      entities: world.count,
      errors: app.gpu.errors,
    };
  });
  assert.equal(report.handles.entities, report.baseline.entities);
  assert.deepEqual(report.handles.errors, []);
  report.environment = {
    mode: "production-preview",
    browser: await browser.version(),
    timestamp: new Date().toISOString(),
  };
  await page.evaluate(async () => {
    // Applies window.rendererApp.dispose to the current callback state.

    await window.rendererApp.dispose();
  });
  await writeFile(
    "artifacts/asset-lifecycle-gpu.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        cycles: report.cycles.length,
        failure: report.failure,
        cancellation: report.cancellation,
        cache: report.cache,
        resourceLeaks: false,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
