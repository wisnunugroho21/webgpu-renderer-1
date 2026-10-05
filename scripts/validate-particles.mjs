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
    if (unchangedRecordBytes || steadyBytes !== 144)
      throw new Error("Analytic motion reuploaded spawn records");
    if (
      JSON.stringify(setupResources) !==
      JSON.stringify(app.renderer.resources.stats)
    )
      throw new Error("Warm particles created GPU resources");
    // Authoring extensions retain the same blend groups and do not rebuild pipelines.
    const white = {
      ...options,
      startColor: [1, 1, 1, 1],
      endColor: [1, 1, 1, 1],
    };
    particles.clear();
    particles.setAtlas({
      width: 2,
      height: 1,
      columns: 2,
      rows: 1,
      pixels: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
    });
    particles.burst(
      { ...white, sprite: { frameCount: 2, fps: 2, loop: true } },
      1,
    );
    const atlasRed = await draw();
    particles.update(0.6);
    const atlasGreen = await draw();
    particles.update(0.5);
    const atlasLoop = await draw();
    if (
      atlasRed.pixel[0] < 250 ||
      atlasGreen.pixel[1] < 250 ||
      atlasGreen.pixel[0] > 1 ||
      atlasLoop.pixel[0] < 250
    )
      throw new Error("Flipbook frame/loop/sRGB sampling failed");
    particles.clear();
    particles.burst(
      { ...white, lifetime: [1, 1], sprite: { frameCount: 2 } },
      1,
    );
    particles.update(0.6);
    if ((await draw()).pixel[1] < 250)
      throw new Error("Lifetime flipbook did not advance");
    particles.clear();
    const curve = particles.createCurve([
      { time: 0, size: 1, color: [1, 1, 1, 0] },
      { time: 0.5, size: 2, color: [0, 1, 0, 1] },
      { time: 1, size: 0, color: [1, 1, 1, 0] },
    ]);
    particles.burst({ ...white, lifetime: [1, 1], curve }, 1);
    const curveStart = await draw();
    particles.update(0.5);
    const curveMid = await draw();
    if (
      difference(curveStart.pixel, background.pixel) ||
      curveMid.pixel[1] < 250 ||
      curveMid.pixel[0] > 1
    )
      throw new Error(
        "Shared GPU lifetime curve did not interpolate opacity/color",
      );
    particles.clear();
    world.meshes.set(app.sceneEntity, 0, 0);
    app.materials.set(0, { baseColor: [0, 0, 0, 1], roughness: 1 });
    const softReferences = [];
    for (const projection of ["orthographic", "perspective"]) {
      if (projection === "perspective")
        app.renderer.camera.setPerspective({
          near: 0.1,
          far: 100,
          fovY: Math.PI / 3,
        });
      const opaque = await draw();
      particles.burst(
        { ...options, position: [0, 0, 1.5], softDistance: 0 },
        1,
      );
      const hard = await draw();
      particles.clear();
      particles.burst(
        { ...options, position: [0, 0, 1.5], softDistance: 1 },
        1,
      );
      const soft = await draw();
      /** Decode sRGB bytes to check half-distance compositing in linear radiance. */
      function linear(value) {
        value /= 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      }
      const fraction =
        (linear(soft.pixel[0]) - linear(opaque.pixel[0])) /
        (linear(hard.pixel[0]) - linear(opaque.pixel[0]));
      if (Math.abs(fraction - 0.5) > 0.025)
        throw new Error(
          `Soft ${projection} depth reconstruction failed: ${fraction}`,
        );
      softReferences.push({ projection, fraction });
      particles.clear();
    }
    app.renderer.camera.setOrthographic({ height: 4, near: 0.1, far: 100 });
    world.meshes.remove(app.sceneEntity);
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
    particles.clear();
    const ribbon = particles.createTrail({
      width: 0.2,
      lifetime: 10,
      color: [1, 0, 0, 1],
    });
    ribbon.addPoint(-1, 0, 0);
    ribbon.addPoint(1, 0, 0);
    const ribbonStart = await draw();
    if (
      ribbonStart.pixel[0] < 250 ||
      app.renderer.stats.particleTrailSegments !== 1
    )
      throw new Error("Ribbon strip did not cover its retained segment");
    world.meshes.set(app.sceneEntity, 0, 0);
    const occludedRibbon = await draw();
    ribbon.clear();
    const ribbonOccluder = await draw();
    if (difference(occludedRibbon.pixels, ribbonOccluder.pixels))
      throw new Error("Opaque depth did not occlude a ribbon");
    ribbon.addPoint(-1, 0, 1.5);
    ribbon.addPoint(1, 0, 1.5);
    const hardRibbon = await draw();
    ribbon.dispose();
    const softRibbon = particles.createTrail({
      width: 0.2,
      lifetime: 10,
      color: [1, 0, 0, 1],
      softDistance: 1,
    });
    softRibbon.addPoint(-1, 0, 1.5);
    softRibbon.addPoint(1, 0, 1.5);
    const softRibbonImage = await draw();
    if (
      softRibbonImage.pixel[0] < 180 ||
      softRibbonImage.pixel[0] > 195 ||
      hardRibbon.pixel[0] < 250
    )
      throw new Error("Ribbon soft depth fade failed");
    softRibbon.dispose();
    world.meshes.remove(app.sceneEntity);
    const joinedRibbon = particles.createTrail({
      width: 0.2,
      lifetime: 10,
      color: [1, 0, 0, 1],
    });
    joinedRibbon.addPoint(-1, 0, 0);
    joinedRibbon.addPoint(0, 0, 0);
    joinedRibbon.addPoint(0, 1, 0);
    if ((await draw()).pixel[0] < 250)
      throw new Error("Ribbon miter join left a gap");
    joinedRibbon.clear();
    joinedRibbon.addPoint(-1, 0, 0);
    joinedRibbon.addPoint(1, 0, 0);
    await draw(); // Establish the changed-history upload before measuring a clock-only frame.
    const ribbonResources = { ...app.renderer.resources.stats };
    particles.update(0.5);
    const ribbonAged = await draw();
    if (
      app.renderer.stats.particleTrailUploadBytes !== 0 ||
      app.renderer.stats.particleUploadBytes !== 144 ||
      ribbonAged.pixel[0] >= ribbonStart.pixel[0]
    )
      throw new Error(
        "Ribbon clock-only fade uploaded history or failed to fade",
      );
    joinedRibbon.addPoint(1, 1, 0);
    await draw();
    if (
      app.renderer.stats.particleTrailSegments !== 2 ||
      JSON.stringify(ribbonResources) !==
        JSON.stringify(app.renderer.resources.stats)
    )
      throw new Error("Ribbon append allocated resources or lost joins");
    const additiveRibbon = particles.createTrail({
      width: 0.1,
      lifetime: 10,
      color: [0, 0, 1, 1],
      blend: "additive",
    });
    additiveRibbon.addPoint(-1, 0, 0);
    additiveRibbon.addPoint(1, 0, 0);
    const mixedRibbons = await draw();
    if (
      mixedRibbons.pixel[2] < 250 ||
      app.renderer.stats.particleDrawCalls !== 2
    )
      throw new Error("Mixed ribbon blend groups/firstInstance failed");
    particles.burst(
      {
        ...white,
        lifetime: [10, 10],
        sprite: { frameCount: 2, fps: 2, loop: true },
        curve,
      },
      1,
    );
    particles.update(0.5);
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
      particles.count !== 1 ||
      particles.trails.count !== 3
    )
      throw new Error("Particle state/image changed during recovery");
    joinedRibbon.dispose();
    additiveRibbon.dispose();
    const ribbonTimings = [];
    particles.clear();
    const measuredRibbons = [];
    for (let i = 0; i < 8; i++) {
      const t = particles.createTrail({
        lifetime: 10,
        width: 0.02,
        blend: "additive",
      });
      for (let j = 0; j < 128; j++)
        t.addPoint((j / 127 - 0.5) * 3, (i - 4) * 0.1, 0);
      measuredRibbons.push(t);
    }
    await draw(false);
    const trailResources = { ...app.renderer.resources.stats };
    for (let i = 0; i < 40; i++) {
      particles.update(1 / 60);
      const sample = await draw(false);
      ribbonTimings.push(sample.cpu);
      if (
        app.renderer.stats.particleTrailUploadBytes !== 0 ||
        app.renderer.stats.particleUploadBytes !== 144
      )
        throw new Error("Steady ribbon benchmark uploaded point history");
    }
    ribbonTimings.sort((a, b) => {
      /* Select the diagnostic median only. */ return a - b;
    });
    if (
      JSON.stringify(trailResources) !==
      JSON.stringify(app.renderer.resources.stats)
    )
      throw new Error("Ribbon benchmark allocated GPU resources");
    const ribbonTiming = {
      segments: app.renderer.stats.particleTrailSegments,
      cpuMedianMs: ribbonTimings[20],
      draws: app.renderer.stats.particleDrawCalls,
      uploadBytes: app.renderer.stats.particleUploadBytes,
    };
    for (const t of measuredRibbons) t.dispose();
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
    const vfxTimings = [];
    world.meshes.set(app.sceneEntity, 0, 0);
    for (const count of [1000, 4000]) {
      particles.clear();
      particles.burst(
        {
          ...white,
          position: [0, 0, 1.5],
          positionSpread: [0.8, 0.8, 0.3],
          startSize: 0.04,
          endSize: 0.04,
          sprite: { frameCount: 2, fps: 12, loop: true },
          curve,
          softDistance: 1,
        },
        count,
      );
      await draw(false);
      const before = { ...app.renderer.resources.stats },
        cpu = [],
        completion = [];
      for (let frame = 0; frame < 40; frame++) {
        particles.update(1 / 60);
        const sample = await draw(false);
        cpu.push(sample.cpu);
        completion.push(sample.completion);
      }
      cpu.sort((a, b) => {
        /* Select the encoded-frame diagnostic median. */ return a - b;
      });
      completion.sort((a, b) => {
        /* Select fenced completion median, outside production rendering. */ return (
          a - b
        );
      });
      if (
        JSON.stringify(before) !==
          JSON.stringify(app.renderer.resources.stats) ||
        app.renderer.stats.particleRecordUploadBytes !== 0 ||
        app.renderer.stats.particleUploadBytes !== 144
      )
        throw new Error(
          "Atlas/curve/soft stress allocated resources or reuploaded records",
        );
      vfxTimings.push({
        count,
        cpuMedianMs: cpu[20],
        completionMedianMs: completion[20],
        draws: app.renderer.stats.particleDrawCalls,
        uploadBytes: app.renderer.stats.particleUploadBytes,
      });
    }
    world.meshes.remove(app.sceneEntity);
    particles.clear();
    await draw();
    const resources = app.renderer.resources;
    await app.dispose();
    return {
      vfxTimings,
      ribbonTiming,
      ribbonPixels: [ribbonStart.pixel, ribbonAged.pixel, mixedRibbons.pixel],
      atlas: [atlasRed.pixel, atlasGreen.pixel, atlasLoop.pixel],
      curveMid: curveMid.pixel,
      softReferences,
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
