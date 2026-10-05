import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startPreviewServer } from "./gpu/preview-server.mjs";
const server = await startPreviewServer(5209, true);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on("pageerror", (error) => {
    /* Keep browser exceptions separate from validation scope failures. */ errors.push(
      error.message,
    );
  });
  await page.goto("http://127.0.0.1:5209");
  await page.waitForFunction(() => {
    /* Wait for complete application startup. */ return (
      window.rendererApp?.frames >= 3
    );
  });
  const report = await page.evaluate(async () => {
    // Serialized browser scenario: readbacks/fences exist only in this diagnostic code.
    const app = window.rendererApp,
      world = app.world,
      particles = app.particles;
    app.stop();
    app.renderer.camera.setPosition(0, 0, 5);
    app.renderer.camera.setTarget(0, 0, 0);
    app.renderer.camera.setOrthographic({ height: 4, near: 0.1, far: 100 });
    world.meshes.remove(app.sceneEntity);
    const gpuErrors = [];
    /** Capture uncaught validation errors on each device used by the recovery test. */
    function watch() {
      app.gpu.device.addEventListener("uncapturederror", (event) => {
        /* Record GPU failures without masking browser exceptions. */ gpuErrors.push(
          event.error.message,
        );
      });
    }
    watch();
    /** Encode one production frame, optionally copying pixels after all scene/particle/post passes. */
    async function draw(read = true) {
      const gpu = app.gpu,
        renderer = app.renderer;
      app.transformSystem.update(world.transforms);
      app.extractor.extract(
        world,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
      const texture = gpu.context.getCurrentTexture(),
        encoder = gpu.device.createCommandEncoder();
      const start = performance.now();
      renderer.encode(
        encoder,
        texture.createView({ format: gpu.renderFormat }),
      );
      const cpu = performance.now() - start;
      let buffer;
      const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
      if (read) {
        buffer = gpu.device.createBuffer({
          size: bytesPerRow * texture.height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
          texture.width,
          texture.height,
        ]);
      }
      gpu.queue.submit([encoder.finish()]);
      await gpu.queue.onSubmittedWorkDone();
      const completion = performance.now() - start;
      if (!read) return { cpu, completion };
      await buffer.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap();
      buffer.destroy();
      const offset =
        Math.floor(texture.height / 2) * bytesPerRow +
        Math.floor(texture.width / 2) * 4;
      const pixel = Array.from(pixels.slice(offset, offset + 4));
      if (gpu.format.startsWith("bgra"))
        [pixel[0], pixel[2]] = [pixel[2], pixel[0]];
      return { cpu, pixel, pixels };
    }
    /** Count differing stored image bytes for deterministic depth and recovery references. */
    function difference(a, b) {
      let count = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
      return count;
    }
    const initialResources = { ...app.renderer.resources.stats };
    const background = await draw();
    if (
      JSON.stringify(initialResources) !==
      JSON.stringify(app.renderer.resources.stats)
    )
      throw new Error("Disabled particles allocated GPU resources");
    app.gpu.device.pushErrorScope("validation");
    particles.enabled = true;
    const setupResources = { ...app.renderer.resources.stats };
    const options = {
      velocity: [0, 0, 0],
      velocitySpread: [0, 0, 0],
      lifetime: [10, 10],
      startSize: 1,
      endSize: 1,
      fadeOut: 0,
      startColor: [1, 0, 0, 1],
      endColor: [1, 0, 0, 1],
      shape: "square",
    };
    particles.burst(options, 1);
    const red = await draw();
    const validation = await app.gpu.device.popErrorScope();
    if (validation) throw new Error(validation.message);
    if (red.pixel[0] < 250 || red.pixel[1] > 1 || red.pixel[2] > 1)
      throw new Error("Incorrect particle color");
    const draws = app.renderer.stats.particleDrawCalls;
    particles.update(0.1);
    await draw();
    const unchangedRecordBytes = app.renderer.stats.particleRecordUploadBytes;
    const steadyBytes = app.renderer.stats.particleUploadBytes;
    if (unchangedRecordBytes || steadyBytes !== 112)
      throw new Error("Analytic motion reuploaded spawn records");
    if (
      JSON.stringify(setupResources) !==
      JSON.stringify(app.renderer.resources.stats)
    )
      throw new Error("Warm particles created GPU resources");
    const shapes = [];
    for (const shape of ["disc", "glow", "ring", "square"]) {
      particles.clear();
      particles.burst({ ...options, shape }, 1);
      const result = await draw();
      if (
        shape === "ring"
          ? difference(result.pixel, background.pixel) !== 0
          : result.pixel[0] < 250
      )
        throw new Error(`Incorrect ${shape} particle coverage`);
      shapes.push({ shape, pixel: result.pixel });
    }
    particles.clear();
    particles.burst({ ...options, velocity: [3, 0, 0] }, 1);
    const beforeMotion = await draw();
    particles.update(0.5);
    const afterMotion = await draw();
    if (
      !difference(beforeMotion.pixels, afterMotion.pixels) ||
      difference(afterMotion.pixel, background.pixel)
    )
      throw new Error("GPU particle motion did not follow elapsed time");
    particles.clear();
    particles.burst({ ...options, fadeIn: 0.5, lifetime: [1, 1] }, 1);
    const fadeStart = await draw();
    particles.update(0.5);
    const fadeMid = await draw();
    if (difference(fadeStart.pixel, background.pixel) || fadeMid.pixel[0] < 250)
      throw new Error("Incorrect particle lifetime fade");
    particles.clear();
    particles.burst(options, 1);
    particles.enabled = false;
    const disabled = await draw();
    if (difference(background.pixels, disabled.pixels))
      throw new Error("Disabled particles still rendered");
    particles.enabled = true;
    world.meshes.set(app.sceneEntity, 0, 0);
    const scene = await draw();
    particles.clear();
    const opaque = await draw();
    const depthDifference = difference(scene.pixels, opaque.pixels);
    if (depthDifference)
      throw new Error("Particles behind opaque geometry ignored scene depth");
    world.meshes.remove(app.sceneEntity);
    particles.burst(
      {
        ...options,
        position: [0, 0, 1],
        startColor: [1, 0, 0, 0.5],
        endColor: [1, 0, 0, 0.5],
      },
      1,
    );
    particles.burst(
      {
        ...options,
        position: [0, 0, -1],
        startColor: [0, 0, 1, 1],
        endColor: [0, 0, 1, 1],
      },
      1,
    );
    const sorted = await draw();
    if (
      Math.abs(sorted.pixel[0] - 188) > 2 ||
      sorted.pixel[1] > 1 ||
      Math.abs(sorted.pixel[2] - 188) > 2
    )
      throw new Error(`Incorrect alpha sort/blend ${sorted.pixel}`);
    app.renderer.camera.setPosition(0, 0, -5);
    const reverseSorted = await draw();
    if (reverseSorted.pixel[2] < 250 || reverseSorted.pixel[0] > 1)
      throw new Error("Alpha order did not follow camera movement");
    app.renderer.camera.setPosition(0, 0, 5);
    particles.clear();
    particles.burst(options, 1);
    particles.burst(
      {
        ...options,
        blend: "additive",
        startColor: [0, 0.25, 0, 1],
        endColor: [0, 0.25, 0, 1],
      },
      1,
    );
    const mixed = await draw();
    if (
      mixed.pixel[0] < 250 ||
      Math.abs(mixed.pixel[1] - 137) > 2 ||
      mixed.pixel[2] > 1 ||
      app.renderer.stats.particleDrawCalls !== 2 ||
      app.renderer.stats.pipelineSwitches !== 2
    )
      throw new Error(
        "Mixed blend groups used incorrect indices or work counters",
      );
    particles.clear();
    particles.burst(
      {
        ...options,
        startColor: [0.25, 0, 0, 1],
        endColor: [0.25, 0, 0, 1],
        blend: "additive",
      },
      2,
    );
    const additive = await draw();
    if (additive.pixel[0] < 185 || additive.pixel[0] > 191)
      throw new Error("Incorrect additive accumulation");
    app.renderer.hdr.enabled = true;
    app.renderer.hdr.toneMapping = "clamp";
    const hdr = await draw();
    if (difference(additive.pixels, hdr.pixels) > 100)
      throw new Error("HDR particles diverged from linear reference");
    app.renderer.hdr.bloomThreshold = 0.1;
    app.renderer.hdr.bloomStrength = 0.5;
    const bloom = await draw();
    const bloomDifference = difference(hdr.pixels, bloom.pixels);
    if (!bloomDifference)
      throw new Error("Particles did not contribute to HDR bloom");
    app.renderer.hdr.bloomStrength = 0;
    app.gpu.renderScale = 0.75;
    await draw();
    app.gpu.renderScale = 1;
    app.renderer.hdr.enabled = false;
    app.renderer.antialiasing = "fxaa";
    await draw(); // FXAA-only still uses the half-float scene target.
    app.renderer.antialiasing = "none";
    const recoveryReference = await draw();
    await app.recoverDevice();
    app.stop();
    watch();
    const recovered = await draw();
    const recoveryDifference = difference(
      recoveryReference.pixels,
      recovered.pixels,
    );
    if (
      recoveryDifference ||
      app.particles !== particles ||
      particles.count !== 2
    )
      throw new Error("Particle state/image changed during recovery");
    const timings = [];
    for (const blend of ["alpha", "additive"])
      for (const count of [1000, 4000]) {
        particles.clear();
        particles.burst(
          {
            ...options,
            startSize: 0.04,
            endSize: 0.04,
            positionSpread: [2, 2, 1],
            blend,
          },
          count,
        );
        await draw(false);
        const before = { ...app.renderer.resources.stats },
          samples = [],
          completions = [];
        for (let frame = 0; frame < 40; frame++) {
          particles.update(1 / 60);
          const sample = await draw(false);
          samples.push(sample.cpu);
          completions.push(sample.completion);
        }
        samples.sort(
          (a, b) => /** Order diagnostic timings for the median. */ a - b,
        );
        if (
          JSON.stringify(before) !==
          JSON.stringify(app.renderer.resources.stats)
        )
          throw new Error("Particle benchmark allocated GPU resources");
        completions.sort(
          (a, b) =>
            /** Order diagnostic completion fences for the median. */ a - b,
        );
        timings.push({
          blend,
          count,
          cpuMedianMs: samples[20],
          completionMedianMs: completions[20],
          draws: app.renderer.stats.particleDrawCalls,
          recordUploadBytes: app.renderer.stats.particleRecordUploadBytes,
          totalUploadBytes: app.renderer.stats.particleUploadBytes,
        });
      }
    particles.clear();
    await draw();
    const resources = app.renderer.resources;
    await app.dispose();
    return {
      shapes,
      red: red.pixel,
      sorted: sorted.pixel,
      additive: additive.pixel,
      mixed: mixed.pixel,
      hdr: hdr.pixel,
      draws,
      unchangedRecordBytes,
      steadyBytes,
      depthDifference,
      recoveryDifference,
      bloomDifference,
      timings,
      gpuErrors,
      finalBuffers: resources.stats.buffers,
      finalTextures: resources.stats.textures,
    };
  });
  assert.deepEqual(report.gpuErrors, []);
  assert.equal(report.finalBuffers, 0);
  assert.equal(report.finalTextures, 0);
  assert.deepEqual(errors, []);
  await page.goto("http://127.0.0.1:5209/?example=particles");
  await page.waitForFunction(() => {
    /* Wait for the demonstration to install and emit particles. */ return (
      window.particleDemoReady && window.rendererApp.particles.count > 0
    );
  });
  await page.locator("canvas").click();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => {
    /* Explosion bursts should add substantially more live particles. */ return (
      window.rendererApp.particles.count > 90
    );
  });
  await page.keyboard.press("KeyP");
  await page.waitForFunction(() => {
    /* Verify the example pause toggle reaches persistent CPU state. */ return !window
      .rendererApp.particles.enabled;
  });
  await page.evaluate(async () => {
    /* Release demonstration GPU owners before closing its browser. */ await window.rendererApp.dispose();
  });
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/particles.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
