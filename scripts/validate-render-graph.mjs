import assert from "node:assert/strict";
import { launchValidationBrowser } from "./gpu/validation-browser.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";
const server = await startPreviewServer(5213, true);
let browser;
try {
  browser = await launchValidationBrowser();
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } }),
    errors = [];
  page.on("pageerror", (error) => {
    // Surface asynchronous browser failures independently of GPU validation scopes.
    errors.push(error.message);
  });
  await page.goto("http://127.0.0.1:5213");
  await page.waitForFunction(() => {
    // Wait until normal startup has prepared shared GPU ownership.
    return window.rendererApp?.frames >= 3;
  });
  const report = await page.evaluate(async () => {
    // Real command ordering verifies that aliased contents survive through their final consumer.
    const app = window.rendererApp,
      r = app.renderer,
      device = app.gpu.device,
      pool = r.resources.targets;
    app.stop();
    device.pushErrorScope("validation");
    const Graph = r.graph.constructor;
    const run = async (shared) => {
      // Compare interval-colored targets with exact-incompatible independent reference allocations.
      const graph = new Graph(),
        buffers = [0, 1].map(() => {
          // Readback buffers belong only to this diagnostic, never the rendering frame loop.
          return device.createBuffer({
            size: 256 * 8,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
        });
      const descriptor = {
        size: [8, 8],
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      };
      let targets;
      graph.transient("a", { descriptor, initialization: "clear" });
      graph.transient("b", {
        descriptor: {
          ...descriptor,
          usage: descriptor.usage | (shared ? 0 : GPUTextureUsage.COPY_DST),
        },
        initialization: "clear",
        exported: true,
      });
      for (const [index, name, color] of [
        [0, "a", [1, 0, 0, 1]],
        [1, "b", [0, 1, 0, 1]],
      ]) {
        graph.add({
          name: `write-${name}`,
          reads: [],
          writes: [name],
          dependsOn: index ? ["capture-a"] : [],
          execute: (encoder) => {
            // Initialize every target texel with a known color before any consumer reads it.
            const pass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: targets.get(name).view,
                  loadOp: "clear",
                  storeOp: "store",
                  clearValue: color,
                },
              ],
            });
            pass.end();
          },
        });
        graph.add({
          name: `capture-${name}`,
          reads: [name],
          writes: [],
          execute: (encoder) => {
            // Copy the last-consumer result before the same physical storage is reassigned.
            encoder.copyTextureToBuffer(
              { texture: targets.get(name).texture },
              { buffer: buffers[index], bytesPerRow: 256 },
              [8, 8],
            );
          },
        });
      }
      graph.compile();
      targets = graph.prepareTargets(pool);
      const same = targets.get("a").texture === targets.get("b").texture;
      const before = { ...r.resources.stats },
        encoder = device.createCommandEncoder();
      graph.execute(encoder, undefined);
      app.gpu.queue.submit([encoder.finish()]);
      const pixels = [];
      for (const buffer of buffers) {
        await buffer.mapAsync(GPUMapMode.READ);
        pixels.push(
          Array.from(new Uint8Array(buffer.getMappedRange()).slice(0, 4)),
        );
        buffer.unmap();
        buffer.destroy();
      }
      const after = { ...r.resources.stats };
      targets.dispose();
      await pool.settle();
      return {
        same,
        pixels,
        logicalBytes: graph.targets.logicalBytes,
        physicalBytes: graph.targets.physicalBytes,
        before,
        after,
      };
    };
    const reference = await run(false),
      aliased = await run(true);
    // A second preparation borrows the same completed physical entry without GPU creation.
    const creations = r.resources.stats.textureCreations,
      repeated = await run(true),
      reuseCreations = r.resources.stats.textureCreations - creations;
    r.hdr.enabled = true;
    r.hdr.bloomStrength = 0.5;
    r.hdr.autoExposure = true;
    r.hdr.resize(64, 64);
    await pool.settle();
    r.hdr.resize(128, 128);
    await pool.settle();
    const priorCreations = r.resources.stats.textureCreations,
      priorHits = pool.stats.hits;
    r.hdr.resize(64, 64);
    await pool.settle();
    const resize = {
      creations: r.resources.stats.textureCreations - priorCreations,
      hits: pool.stats.hits - priorHits,
      pool: { ...pool.stats },
    };
    r.hdr.resize(app.canvas.width, app.canvas.height);
    await pool.settle();
    const warm = { ...r.resources.stats },
      rows = [];
    for (let i = 0; i < 60; i++) {
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
      if (i >= 30) rows.push({ cpu, completion: performance.now() - start });
    }
    const median = (key) => {
      // Timing statistics are diagnostic work after warm-up, outside ordinary rendering.
      return rows
        .map((row) => {
          // Select the requested CPU or completed-GPU timing sample.
          return row[key];
        })
        .sort((a, b) => {
          // Numeric ordering yields the median warmed frame measurement.
          return a - b;
        })[15];
    };
    const timings = {
        cpuMs: median("cpu"),
        completionMs: median("completion"),
      },
      afterWarm = { ...r.resources.stats },
      gpuError = (await device.popErrorScope())?.message ?? null,
      gpuErrors = [...app.gpu.errors];
    r.dispose();
    await pool.settle();
    return {
      reference,
      aliased,
      repeated,
      reuseCreations,
      resize,
      warm,
      afterWarm,
      timings,
      gpuError,
      gpuErrors,
      disposed: {
        textures: r.resources.stats.textures,
        bytes: r.resources.stats.textureBytes,
        pool: { ...pool.stats },
      },
    };
  });
  assert.equal(report.reference.same, false);
  assert.equal(report.aliased.same, true);
  assert.equal(report.aliased.logicalBytes, 512);
  assert.equal(report.aliased.physicalBytes, 256);
  assert.deepEqual(report.aliased.pixels, [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
  ]);
  assert.deepEqual(report.aliased.pixels, report.reference.pixels);
  assert.equal(report.reuseCreations, 0);
  assert.equal(report.resize.creations, 0);
  assert.ok(report.resize.hits > 1);
  for (const key of [
    "textureCreations",
    "bufferCreations",
    "pipelineCreations",
    "shaderModules",
    "samplerCreations",
  ]) {
    assert.equal(report.aliased.before[key], report.aliased.after[key]);
    assert.equal(report.warm[key], report.afterWarm[key]);
  }
  assert.equal(report.gpuError, null);
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(errors, []);
  assert.equal(report.disposed.textures, 0);
  assert.equal(report.disposed.bytes, 0);
  assert.equal(report.disposed.pool.idleBytes, 0);
  await mkdir("benchmarks/results", { recursive: true });
  await writeFile(
    "benchmarks/results/render-graph-gpu.json",
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
