import { launchValidationBrowser } from "./gpu/validation-browser.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { startPreviewServer } from "./gpu/preview-server.mjs";
await mkdir("artifacts", { recursive: true });
// Ensure the fixtures really require compression; an uncompressed fallback is insufficient.
const io = new NodeIO();
for (const [name, extension] of [
  ["draco", "KHR_draco_mesh_compression"],
  ["meshopt", "EXT_meshopt_compression"],
]) {
  const json = await io.readAsJSON(`public/regression/triangle-${name}.glb`);
  assert.ok(json.json.extensionsRequired.includes(extension));
  assert.ok(JSON.stringify(json.json).includes(`"${extension}":`));
}
const server = await startPreviewServer(5197, true);
let browser;
try {
  browser = await launchValidationBrowser();
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } }),
    errors = [];
  page.on("pageerror", (e) =>
    /** Delegates this operation to errors.push. */ errors.push(e.message),
  );
  await page.goto("http://127.0.0.1:5197");
  await page.waitForFunction(
    () =>
      /** Evaluates the window.rendererApp?.frames >= 3 condition. */ window
        .rendererApp?.frames >= 3,
  );
  const report = await page.evaluate(async () => {
    // Returns result.

    const app = window.rendererApp;
    app.stop();
    app.autoRecoverDevice = false;
    app.world.destroy(app.sceneEntity);
    app.world.lights.castShadow[app.defaultLightEntity] = 1;
    app.renderer.shadows.cacheEnabled = false;
    app.gpu.device.pushErrorScope("validation");
    /** Prepares the current scene, submits GPU work and reads pixels only for this diagnostic scenario. */
    const draw = async (read = true) => {
      const w = app.world,
        r = app.renderer,
        device = app.gpu.device;
      app.animations.update(0);
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
      let buffer;
      const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
      if (read) {
        buffer = device.createBuffer({
          size: bytesPerRow * texture.height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
          texture.width,
          texture.height,
        ]);
      }
      app.gpu.queue.submit([encoder.finish()]);
      if (!read) {
        await app.gpu.queue.onSubmittedWorkDone();
        return;
      }
      await buffer.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap();
      buffer.destroy();
      return data;
    };
    /** Compares diagnostic pixel buffers and reports their differing values. */
    const difference = (a, b) => {
      let max = 0,
        pixels = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        max = Math.max(max, d);
        if (d) pixels++;
      }
      return { max, bytes: pixels };
    };
    /** Builds a record containing url, load ms. */
    const load = async (name, worker = false) => {
      app.assetDecoder.thresholdBytes = worker ? 0 : Infinity;
      const url = `/regression/${name}.glb`,
        start = performance.now();
      await app.loadAssetHandles(url);
      for (const animator of app.animations.animators) {
        animator.play();
        animator.currentTime = 0.7;
      }
      for (const state of app.animations.morphStates) {
        state.weights.fill(0.05);
        state.dirty = true;
      }
      return { url, loadMs: performance.now() - start };
    };
    const baseline = await load("triangle"),
      plain = await draw();
    await app.unloadAsset(baseline.url);
    const geometry = [];
    for (const worker of [false, true])
      for (const name of ["triangle-draco", "triangle-meshopt"]) {
        const item = await load(name, worker),
          image = await draw();
        geometry.push({
          ...item,
          worker,
          difference: difference(plain, image),
        });
        await app.unloadAsset(item.url);
      }
    const skin = [];
    for (const [plainName, eightName] of [
      ["skinned", "skinned-eight"],
      ["skinned", "skinned-secondary"],
      ["crowd-combined", "combined-eight"],
    ]) {
      const reference = await load(plainName),
        images = [];
      for (const mode of ["individual", "instanced", "gpu-indirect"]) {
        app.renderer.submissionMode = mode;
        app.renderer.depthPrepass.enabled = true;
        app.renderer.shadows.enabled = true;
        images.push(await draw());
      }
      const referenceTimes = [];
      for (let i = 0; i < 60; i++) {
        const start = performance.now();
        await draw(false);
        if (i >= 30) referenceTimes.push(performance.now() - start);
      }
      referenceTimes.sort((a, b) => /** Computes the a - b result. */ a - b);
      const referenceCompletionMs = referenceTimes[15];
      await app.unloadAsset(reference.url);
      const item = await load(eightName),
        comparisons = [];
      for (const [index, mode] of [
        "individual",
        "instanced",
        "gpu-indirect",
      ].entries()) {
        app.renderer.submissionMode = mode;
        comparisons.push({
          mode,
          difference: difference(images[index], await draw()),
        });
      }
      const w = app.world,
        r = app.renderer;
      let entity = -1;
      for (let e = 0; e < w.nextEntity; e++)
        if (w.alive[e] && w.meshes.has[e] && w.skins.has[e]) {
          entity = e;
          break;
        }
      const base = w.meshes.meshId[entity],
        primitive = app.assetLoader.records.get(item.url).decoded.meshes[0]
          .primitives[0],
        variant = r.meshes.upload(primitive);
      const group = r.lodGroups.register(
        [base, variant],
        [1000000, 1],
        r.meshes,
      );
      w.meshes.setLOD(entity, group);
      r.gpuLOD.enabled = true;
      const lodImage = await draw(),
        count = app.renderWorld.count,
        buffer = app.gpu.device.createBuffer({
          size: count * 4,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
        encoder = app.gpu.device.createCommandEncoder();
      encoder.copyBufferToBuffer(
        r.gpuLOD.selectedMeshes,
        0,
        buffer,
        0,
        count * 4,
      );
      app.gpu.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const selected = Array.from(new Uint32Array(buffer.getMappedRange()));
      buffer.unmap();
      buffer.destroy();
      const lod = {
        difference: difference(images[2], lodImage),
        selectedVariant: selected.includes(variant),
        baseOffset: r.meshes.get(base).morphOffset,
        variantOffset: r.meshes.get(variant).morphOffset,
      };
      w.meshes.setLOD(entity, -1);
      r.lodGroups.entries.pop();
      r.meshes.destroy(variant);
      r.gpuLOD.enabled = false;
      await draw(false);
      const resources = { ...app.renderer.resources.stats },
        times = [];
      for (let i = 0; i < 60; i++) {
        const start = performance.now();
        await draw(false);
        if (i >= 30) times.push(performance.now() - start);
      }
      times.sort((a, b) => /** Computes the a - b result. */ a - b);
      skin.push({
        ...item,
        referenceCompletionMs,
        lod,
        comparisons,
        shadowDrawCalls: r.stats.shadowDrawCalls,
        depthDrawCalls: r.stats.depthDrawCalls,
        resources,
        warm: { ...app.renderer.resources.stats },
        completionMs: times[15],
      });
      await app.unloadAsset(item.url);
    }
    const basis = [];
    for (const name of ["triangle-basis-etc1s", "triangle-basis-uastc"]) {
      const item = await load(name),
        before = await draw(),
        resources = { ...app.renderer.resources.stats };
      for (let i = 0; i < 30; i++) await draw(false);
      basis.push({
        ...item,
        resources,
        warm: { ...app.renderer.resources.stats },
        visible: difference(plain, before).bytes > 100,
      });
      await app.unloadAsset(item.url);
    }
    const fallbackDevice = await (
      await navigator.gpu.requestAdapter()
    ).requestDevice();
    fallbackDevice.pushErrorScope("validation");
    const fallbackResources = new app.renderer.resources.constructor(
        fallbackDevice,
      ),
      fallbackTextures = new app.renderer.textures.constructor(
        fallbackDevice,
        fallbackResources,
      ),
      fallback = [];
    for (const name of ["etc1s", "uastc"]) {
      const bytes = new Uint8Array(
        await (await fetch(`/regression/basis-${name}.ktx2`)).arrayBuffer(),
      );
      const start = performance.now(),
        data = await fallbackTextures.basis.decode(bytes, true);
      fallback.push({
        name,
        format: data.format,
        levels: data.levels.length,
        bytes: data.levels.reduce(
          (sum, level) =>
            /** Computes the sum + level.data.byteLength result. */ sum +
            level.data.byteLength,
          0,
        ),
        decodeMs: performance.now() - start,
      });
      const asset = await app.gltf.load(
          `/regression/triangle-basis-${name}.glb`,
        ),
        groups = await fallbackTextures.prepare(asset);
      await fallbackTextures.release(groups);
    }
    const fallbackError = await fallbackDevice.popErrorScope();
    fallbackTextures.dispose();
    fallbackResources.dispose();
    fallbackDevice.destroy();
    // Recover a live combined eight-weight mesh and a transcoded texture together.
    const eight = await load("combined-eight"),
      texture = await load("triangle-basis-uastc"),
      before = await draw();
    const validationError = await app.gpu.device.popErrorScope();
    const oldGPU = app.gpu,
      old = app.renderer;
    oldGPU.device.destroy();
    await oldGPU.device.lost;
    await app.recoverDevice();
    app.gpu.device.pushErrorScope("validation");
    const recovered = difference(before, await draw()),
      recoveryError = await app.gpu.device.popErrorScope();
    const result = {
      geometry,
      skin,
      basis,
      fallback,
      fallbackError: fallbackError?.message ?? null,
      recovered,
      validationError: validationError?.message ?? null,
      recoveryError: recoveryError?.message ?? null,
      decoder: { ...app.assetDecoder.metrics },
      gpuErrors: app.gpu.errors,
      oldResources: { ...old.resources.stats },
    };
    await app.unloadAsset(eight.url);
    await app.unloadAsset(texture.url);
    await app.dispose();
    result.finalResources = { ...app.renderer.resources.stats };
    return result;
  });
  await writeFile(
    "artifacts/codecs.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  for (const item of report.geometry)
    assert.deepEqual(item.difference, { max: 0, bytes: 0 });
  for (const item of report.skin) {
    assert.ok(item.shadowDrawCalls > 0);
    assert.ok(item.depthDrawCalls > 0);
    assert.ok(item.lod.selectedVariant);
    assert.notEqual(item.lod.baseOffset, item.lod.variantOffset);
    assert.deepEqual(item.lod.difference, { max: 0, bytes: 0 });
    for (const mode of item.comparisons)
      assert.ok(mode.difference.max <= 1, JSON.stringify(mode));
    assert.deepEqual(item.resources, item.warm);
  }
  for (const item of report.basis) {
    assert.ok(item.visible);
    assert.deepEqual(item.resources, item.warm);
  }
  assert.deepEqual(report.recovered, { max: 0, bytes: 0 });
  for (const item of report.fallback) {
    assert.equal(item.format, "rgba8unorm-srgb");
    assert.equal(item.levels, 6);
  }
  assert.equal(report.fallbackError, null);
  assert.equal(report.validationError, null);
  assert.equal(report.recoveryError, null);
  assert.equal(report.decoder.workerJobs, 2);
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(errors, []);
  assert.equal(report.finalResources.buffers, 0);
  assert.equal(report.finalResources.textures, 0);
  await writeFile(
    "artifacts/codecs.json",
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
