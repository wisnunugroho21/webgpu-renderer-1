import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "5188",
    "--strictPort",
  ],
  { stdio: "pipe" },
);
let output = "";
server.stdout.on("data", (c) => (output += c));
server.stderr.on("data", (c) => (output += c));
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(output);
    if (
      output.includes("http://127.0.0.1:5188") &&
      (await fetch("http://127.0.0.1:5188")).ok
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 2,
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5188");
  await page.waitForFunction(() => window.rendererApp?.frames >= 3);
  const report = await page.evaluate(async () => {
    const original = window.rendererApp,
      Application = original.constructor;
    original.stop();
    const results = {
      materials: [],
      animation: [],
      morph: [],
      combined: null,
      occlusion: [],
    };
    const median = (values) =>
      values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const withApp = async (capacity, run) => {
      const canvas = document.createElement("canvas"),
        status = document.createElement("output");
      canvas.style.width = "640px";
      canvas.style.height = "480px";
      document.body.append(canvas);
      const app = new Application(canvas, status, capacity, 16384);
      await app.start();
      app.stop();
      app.world.destroy(app.sceneEntity);
      app.renderer.cullingEnabled = false;
      app.renderer.camera.setPosition(0, 0, 60);
      app.renderer.camera.setTarget(0, 0, 0);
      app.gpu.device.pushErrorScope("validation");
      try {
        return await run(app);
      } finally {
        const error = await app.gpu.device.popErrorScope();
        if (error) throw new Error(error.message);
        if (app.gpu.errors.length) throw new Error(app.gpu.errors.join("\n"));
        app.dispose();
        canvas.remove();
      }
    };
    const measure = async (app, before = () => {}) => {
      const r = app.renderer,
        gpu = app.gpu,
        rows = [];
      let time = 0;
      const resources = { ...r.resources.stats };
      for (let frame = 0; frame < 10; frame++) {
        const row = {},
          start = performance.now();
        let t = start;
        before(frame);
        app.animations.update(1 / 60);
        row.animation = performance.now() - t;
        t = performance.now();
        app.transformSystem.update(app.world.transforms);
        row.transforms = performance.now() - t;
        t = performance.now();
        app.skeletonSystem.update(app.world, app.skeletons);
        row.skeletons = performance.now() - t;
        t = performance.now();
        app.animatedBounds.update(
          app.world,
          r.meshes,
          app.skeletons,
          app.animations.morphPool,
        );
        row.bounds = performance.now() - t;
        t = performance.now();
        app.extractor.extract(
          app.world,
          app.renderWorld,
          app.skeletons,
          app.animations.morphPool,
        );
        row.extraction = performance.now() - t;
        r.stats.activeAnimators = app.animations.activeAnimators;
        r.gpuProfiler.enabled = frame >= 7;
        const encoder = gpu.device.createCommandEncoder();
        t = performance.now();
        r.encode(
          encoder,
          gpu.context
            .getCurrentTexture()
            .createView({ format: gpu.renderFormat }),
        );
        row.encoding = performance.now() - t;
        gpu.queue.submit([encoder.finish()]);
        row.cpuFrame = performance.now() - start;
        await gpu.queue.onSubmittedWorkDone();
        row.completion = performance.now() - start;
        if (frame >= 5) rows.push(row);
        time += 1 / 60;
      }
      r.gpuProfiler.enabled = false;
      const intervals = await r.gpuProfiler.readSamples(),
        passes = {};
      for (const interval of intervals)
        (passes[interval.pass] ??= []).push(interval.milliseconds);
      const cpu = {};
      for (const key of Object.keys(rows[0]))
        cpu[key] = median(rows.map((row) => row[key]));
      const after = { ...r.resources.stats };
      // Initial dynamic/shadow state is warm after setup; resource creation is cold only.
      return {
        cpuMedianMs: cpu,
        gpuPassMedianMs: Object.fromEntries(
          Object.entries(passes).map(([key, values]) => [key, median(values)]),
        ),
        stats: { ...r.stats },
        resourcesBefore: resources,
        resourcesAfter: after,
        size: [canvasWidth(app), app.canvas.height],
      };
    };
    const captureImage = async (app) => {
      const gpu = app.gpu,
        texture = gpu.context.getCurrentTexture(),
        row = Math.ceil((texture.width * 4) / 256) * 256,
        rb = gpu.device.createBuffer({
          size: row * texture.height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
        encoder = gpu.device.createCommandEncoder();
      app.renderer.encode(
        encoder,
        texture.createView({ format: gpu.renderFormat }),
      );
      encoder.copyTextureToBuffer(
        { texture },
        { buffer: rb, bytesPerRow: row },
        [texture.width, texture.height],
      );
      gpu.queue.submit([encoder.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(rb.getMappedRange()).slice();
      rb.unmap();
      rb.destroy();
      return bytes;
    };
    const visibleCount = async (app) => {
      const gpu = app.gpu,
        rb = gpu.device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
        encoder = gpu.device.createCommandEncoder();
      encoder.copyBufferToBuffer(
        app.renderer.gpuCompaction.counter,
        0,
        rb,
        0,
        16,
      );
      gpu.queue.submit([encoder.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const count = new Uint32Array(rb.getMappedRange())[0];
      rb.unmap();
      rb.destroy();
      return count;
    };
    const canvasWidth = (app) => app.canvas.width;
    await withApp(16384, async (app) => {
      const entities = [];
      for (let i = 0; i < 1000; i++) {
        const e = app.world.create();
        app.world.transforms.add(e);
        app.world.transforms.setPosition(
          e,
          ((i % 32) - 16) * 1.2,
          (Math.floor(i / 32) - 16) * 1.2,
          0,
        );
        app.world.transforms.setScale(e, 0.4, 0.4, 0.4);
        app.world.meshes.set(e, 0, 0);
        app.world.bounds.setAABB(e, [-1, -1, -1], [1, 1, 1]);
        entities.push(e);
      }
      const ids = Array.from({ length: 1000 }, (_, i) =>
        app.materials.create({
          baseColor: [
            ((i % 7) + 1) / 8,
            ((i % 11) + 1) / 12,
            ((i % 13) + 1) / 14,
            1,
          ],
        }),
      );
      for (const count of [1, 100, 1000])
        for (const mode of ["individual", "sorted", "instanced"]) {
          app.renderer.submissionMode = mode;
          for (let i = 0; i < entities.length; i++)
            app.world.meshes.materialId[entities[i]] = ids[i % count];
          results.materials.push({
            materials: count,
            mode,
            ...(await measure(app)),
          });
        }
    });
    for (const count of [1, 100, 500, 1000])
      await withApp(100000, async (app) => {
        for (let i = 0; i < count; i++) {
          const entities = await app.loadAsset("/regression/crowd-skin.glb");
          app.world.transforms.setPosition(
            entities[0],
            ((i % 32) - 16) * 1.2,
            (Math.floor(i / 32) - 16) * 1.2,
            0,
          );
          const animator = app.animations.animators[i];
          animator.play(0);
          animator.currentTime = (i % 10) * 0.01;
        }
        const measured = await measure(app);
        measured.sharedSkeleton = app.skeletons.instances.every(
          (s) => s.asset === app.skeletons.instances[0].asset,
        );
        measured.sharedClip = app.animations.animators.every(
          (a) => a.clips === app.animations.animators[0].clips,
        );
        results.animation.push({
          characters: count,
          jointsPerCharacter: 64,
          verticesPerCharacter: 400,
          ...measured,
        });
      });
    const updateMorph = (app, active, frame) => {
      for (const state of app.animations.morphStates) {
        for (let t = 0; t < state.targetCount; t++)
          state.weights[t] = t < active ? 0.1 + (frame + 1) * 0.001 : 0;
        state.dirty = true;
      }
    };
    await withApp(16384, async (app) => {
      for (let i = 0; i < 1000; i++) {
        const entities = await app.loadAsset("/regression/crowd-morph.glb");
        app.world.transforms.setPosition(
          entities[0],
          ((i % 32) - 16) * 1.2,
          (Math.floor(i / 32) - 16) * 1.2,
          0,
        );
      }
      for (const active of [0, 1, 4, 8, 16])
        results.morph.push({
          characters: 1000,
          activeTargets: active,
          verticesPerCharacter: 400,
          ...(await measure(app, (frame) => updateMorph(app, active, frame))),
        });
    });
    await withApp(100000, async (app) => {
      for (let i = 0; i < 1000; i++) {
        const entities = await app.loadAsset("/regression/crowd-combined.glb");
        app.world.transforms.setPosition(
          entities[0],
          ((i % 32) - 16) * 1.2,
          (Math.floor(i / 32) - 16) * 1.2,
          0,
        );
        app.animations.animators[i].play(0);
      }
      results.combined = {
        characters: 1000,
        jointsPerCharacter: 64,
        activeTargets: 16,
        verticesPerCharacter: 400,
        ...(await measure(app, (frame) => updateMorph(app, 16, frame))),
      };
    });
    await withApp(16384, async (app) => {
      const r = app.renderer;
      r.camera.setPosition(0, 0, 5);
      r.camera.setTarget(0, 0, 0);
      r.submissionMode = "gpu-indirect";
      if (!r.gpuDraws.supported) {
        results.occlusion.push({ unsupported: true });
        return;
      }
      const wallMesh = r.meshes.upload({
        attributes: {
          POSITION: new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]),
        },
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        mode: 4,
        material: 0,
        targets: [],
      });
      const wall = app.world.create();
      app.world.transforms.add(wall);
      app.world.transforms.setPosition(wall, 0, 0, 1);
      app.world.meshes.set(wall, wallMesh, 0);
      app.world.bounds.setAABB(wall, [-2, -2, 0], [2, 2, 0]);
      for (let i = 0; i < 10000; i++) {
        const e = app.world.create();
        app.world.transforms.add(e);
        app.world.transforms.setPosition(
          e,
          ((i % 100) - 50) * 0.01,
          (Math.floor(i / 100) - 50) * 0.01,
          -(i % 10) * 0.1,
        );
        app.world.transforms.setScale(e, 0.005, 0.005, 0.005);
        app.world.meshes.set(e, 0, 0);
        app.world.bounds.setAABB(e, [-1, -1, -1], [1, 1, 1]);
      }
      let frustumImage;
      for (const enabled of [false, true]) {
        r.gpuOcclusion.enabled = enabled;
        r.hiz.enabled = r.depthPrepass.enabled = enabled;
        const measured = await measure(app),
          image = await captureImage(app);
        measured.visibleInstances = await visibleCount(app);
        if (!enabled) frustumImage = image;
        else {
          let different = 0,
            maximum = 0;
          for (let i = 0; i < image.length; i++) {
            const delta = Math.abs(image[i] - frustumImage[i]);
            if (delta) different++;
            maximum = Math.max(maximum, delta);
          }
          measured.imageDifference = {
            differingBytes: different,
            maxDifference: maximum,
          };
        }
        results.occlusion.push({ occlusion: enabled, ...measured });
      }
    });
    return results;
  });
  report.environment = {
    browser: await browser.version(),
    timestamp: new Date().toISOString(),
    mode: "production-preview",
  };
  report.pageErrors = errors;
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/benchmark-matrix.json",
    JSON.stringify(report, null, 2),
  );
  assert.deepEqual(errors, []);
  for (const row of report.materials) {
    assert.equal(
      row.stats.materialSwitches,
      row.mode === "individual" && row.materials > 1 ? 1000 : row.materials,
    );
    assert.equal(row.stats.pipelineSwitches, 1);
    assert.equal(
      row.stats.drawCalls,
      row.mode === "instanced" ? row.materials : 1000,
    );
  }
  for (const row of report.animation) {
    assert.equal(row.stats.activeAnimators, row.characters);
    assert.equal(row.stats.jointCount, row.characters * 64);
    assert.equal(row.stats.instances, row.characters);
    assert.equal(row.stats.jointUploadBytes, row.characters * 4096);
    assert.equal(row.sharedSkeleton, true);
    assert.equal(row.sharedClip, true);
    assert.equal(row.stats.drawCalls, 1);
  }
  for (const row of report.morph) {
    assert.equal(row.stats.instances, 1000);
    assert.equal(row.stats.activeMorphTargets, row.activeTargets * 1000);
    assert.equal(row.stats.morphUploadBytes, row.activeTargets * 4000);
    assert.equal(row.stats.drawCalls, 1);
  }
  assert.equal(report.combined.stats.jointCount, 64000);
  assert.equal(report.combined.stats.activeMorphTargets, 16000);
  for (const row of [
    ...report.materials,
    ...report.animation,
    ...report.morph,
    report.combined,
    ...report.occlusion,
  ]) {
    for (const key of [
      "pipelineCreations",
      "shaderModules",
      "bufferCreations",
      "textureCreations",
      "samplerCreations",
    ])
      assert.equal(row.resourcesBefore[key], row.resourcesAfter[key]);
  }
  if (!report.occlusion[0].unsupported) {
    assert.equal(report.occlusion[0].visibleInstances, 10001);
    assert.equal(report.occlusion[1].visibleInstances, 1);
    assert.equal(report.occlusion[1].imageDifference.maxDifference, 0);
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
