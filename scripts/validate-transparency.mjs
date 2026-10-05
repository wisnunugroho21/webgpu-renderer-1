import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startPreviewServer } from "./gpu/preview-server.mjs";
const server = await startPreviewServer(5214, true);
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
  await page.goto("http://127.0.0.1:5214");
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
    app.renderer.clearColor = { r: 0, g: 0, b: 0, a: 1 };
    particles.enabled = true;
    const material = app.materials.create({
      unlit: true,
      doubleSided: true,
      alphaMode: "BLEND",
      baseColor: [1, 0, 0, 0.5],
    });
    const mesh = app.renderer.meshes.upload({
      attributes: {
        POSITION: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
        NORMAL: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      },
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      mode: 4,
      material: 0,
      targets: [],
    });
    const entities = [];
    for (const z of [-1, 1]) {
      const e = world.create();
      world.transforms.add(e);
      world.transforms.setPosition(e, 0, 0, z);
      world.meshes.set(e, mesh, material);
      world.bounds.setSphere(e, 0, 0, 0, 1.5);
      entities.push(e);
    }
    particles.burst(
      {
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        velocitySpread: [0, 0, 0],
        lifetime: [100, 100],
        startSize: 2,
        endSize: 2,
        startColor: [0, 0, 1, 0.5],
        endColor: [0, 0, 1, 0.5],
        fadeOut: 0,
        shape: "square",
      },
      1,
    );
    const trail = particles.createTrail({
      width: 1,
      lifetime: 100,
      color: [0, 1, 0, 0.5],
      endColor: [0, 1, 0, 0.5],
    });
    trail.addPoint(-1, 0, -2);
    trail.addPoint(1, 0, -2);
    /** Convert the independent linear source-over reference to stored sRGB bytes. */
    function srgb(x) {
      return Math.round(
        255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055),
      );
    }
    /** Compare the center sample to an analytic blend reference, allowing storage quantization. */
    function check(pixel, linear, label) {
      const expected = linear.map(srgb);
      if (
        expected.some(
          (value, i) =>
            /** Allow only small final storage quantization differences. */ Math.abs(
              value - pixel[i],
            ) > 3,
        )
      )
        throw new Error(`${label}: ${pixel} expected ${expected}`);
    }
    const checks = [];
    for (const mode of ["individual", "instanced", "gpu-indirect"]) {
      if (mode === "gpu-indirect" && !app.renderer.gpuDraws.supported) continue;
      app.renderer.submissionMode = mode;
      for (const prepass of [false, true]) {
        app.renderer.depthPrepass.enabled = prepass;
        for (const hdr of [false, true]) {
          app.renderer.hdr.enabled = hdr;
          app.renderer.hdr.toneMapping = "clamp";
          for (const reverse of [false, true]) {
            app.renderer.camera.setPosition(0, 0, reverse ? -5 : 5);
            const result = await draw();
            check(
              result.pixel,
              reverse ? [0.3125, 0.5, 0.125] : [0.625, 0.0625, 0.25],
              `${mode}/${prepass}/${hdr}/${reverse}`,
            );
            const schedule = app.renderer.transparency;
            const kinds = Array.from(schedule.kind.subarray(0, schedule.count));
            if (
              JSON.stringify(kinds) !==
              JSON.stringify(reverse ? [0, 1, 0, 2] : [2, 0, 1, 0])
            )
              throw new Error(`Incorrect shared schedule ${kinds}`);
            if (app.renderer.stats.particleDrawCalls !== 2)
              throw new Error("Alpha effect ranges did not coalesce");
            checks.push({
              mode,
              prepass,
              hdr,
              reverse,
              pixel: result.pixel,
              kinds,
            });
          }
        }
      }
    }
    // Multiple GPU LOD candidates must remain adjacent to their source mesh rank.
    if (app.renderer.gpuDraws.supported) {
      const lod = app.renderer.lodGroups.register(
        [mesh, mesh],
        [100000, 1],
        app.renderer.meshes,
        0,
      );
      for (const entity of entities) world.meshes.setLOD(entity, lod);
      app.renderer.submissionMode = "gpu-indirect";
      app.renderer.camera.setPosition(0, 0, 5);
      app.renderer.gpuLOD.enabled = true;
      check(
        (await draw()).pixel,
        [0.625, 0.0625, 0.25],
        "indirect-lod-candidates",
      );
      if (app.renderer.transparency.count !== 6)
        throw new Error("LOD candidates lost shared source depth");
      for (const entity of entities) world.meshes.setLOD(entity, -1);
      app.renderer.gpuLOD.enabled = false;
    }
    // Pipeline family crossings must restore shared mesh bindings after particle shaders.
    const shader = await app.registerMaterialShader({
      name: "transparent-unlit",
      source:
        "fn shadeMaterial(s: MaterialSurface, p: MaterialShaderParameters) -> vec3<f32> { return s.baseColor.rgb; }",
    });
    app.materials.setShader(material, shader);
    app.renderer.submissionMode = "instanced";
    app.renderer.camera.setPosition(0, 0, 5);
    check((await draw()).pixel, [0.625, 0.0625, 0.25], "custom-family");
    // Environment group restoration and FXAA-only linear targets share the same alpha schedule.
    const faces = Array.from({ length: 6 }, () => {
      // Constant faces isolate composition from authored lighting differences in an unlit material.
      return new Float32Array([0.2, 0.2, 0.2, 1]);
    });
    await app.renderer.setEnvironment({
      diffuse: { size: 1, faces },
      specular: [{ size: 1, faces }],
      brdf: { size: 1, pixels: new Float32Array([1, 0, 0, 1]) },
    });
    check((await draw()).pixel, [0.625, 0.0625, 0.25], "environment-family");
    app.renderer.hdr.enabled = false;
    app.renderer.hdr.antialiasing = "fxaa";
    check((await draw()).pixel, [0.625, 0.0625, 0.25], "fxaa-only");
    app.renderer.hdr.antialiasing = "none";
    app.renderer.hdr.enabled = true;
    // Additive contributions remain visible even when authored behind all alpha layers.
    particles.burst(
      {
        position: [0, 0, -3],
        velocity: [0, 0, 0],
        velocitySpread: [0, 0, 0],
        lifetime: [100, 100],
        startSize: 2,
        endSize: 2,
        startColor: [1, 1, 1, 0.1],
        endColor: [1, 1, 1, 0.1],
        fadeOut: 0,
        shape: "square",
        blend: "additive",
      },
      1,
    );
    const additive = particles.createTrail({
      width: 1,
      lifetime: 100,
      color: [1, 1, 1, 0.1],
      endColor: [1, 1, 1, 0.1],
      blend: "additive",
    });
    additive.addPoint(-1, 0, -4);
    additive.addPoint(1, 0, -4);
    const additiveImage = await draw();
    check(additiveImage.pixel, [0.825, 0.2625, 0.45], "additive-tail");
    const resources = { ...app.renderer.resources.stats };
    const timings = [];
    for (let i = 0; i < 35; i++) timings.push((await draw(false)).cpu);
    if (
      JSON.stringify(resources) !== JSON.stringify(app.renderer.resources.stats)
    )
      throw new Error("Unified transparency created warm GPU resources");
    if (
      app.renderer.stats.particleRecordUploadBytes ||
      app.renderer.stats.particleTrailUploadBytes ||
      app.renderer.stats.particleUploadBytes !== 144
    )
      throw new Error("Steady ordering reuploaded persistent effect data");
    const reference = await draw();
    await app.recoverDevice();
    app.stop();
    watch();
    const recovered = await draw();
    if (difference(reference.pixels, recovered.pixels))
      throw new Error("Unified transparency changed after recovery");
    // Disabled effects still leave mesh transparency in the unified stage.
    particles.enabled = false;
    check((await draw()).pixel, [0.75, 0, 0], "disabled-effects");
    // An opaque foreground surface must occlude every transparent type.
    const opaque = app.materials.create({
      unlit: true,
      doubleSided: true,
      baseColor: [1, 1, 0, 1],
    });
    const blocker = world.create();
    world.transforms.add(blocker);
    world.transforms.setPosition(blocker, 0, 0, 2);
    world.meshes.set(blocker, mesh, opaque);
    world.bounds.setSphere(blocker, 0, 0, 0, 1.5);
    particles.enabled = true;
    check((await draw()).pixel, [1, 1, 0], "opaque-depth");
    // Stress fully alternating mesh/billboard/ribbon depths while retaining all shared resources.
    world.meshes.remove(blocker);
    for (const entity of entities) world.meshes.remove(entity);
    particles.clear();
    const stressTrail = particles.createTrail({
      width: 0.01,
      lifetime: 100,
      color: [0, 1, 0, 0.5],
      endColor: [0, 1, 0, 0.5],
    });
    for (let i = 0; i < 128; i++) {
      const z = -3 + i * 0.03;
      const entity = world.create();
      world.transforms.add(entity);
      world.transforms.setPosition(entity, 0, 0, z);
      world.transforms.setScale(entity, 0.01, 0.01, 0.01);
      world.meshes.set(entity, mesh, material);
      world.bounds.setSphere(entity, 0, 0, 0, 1.5);
      particles.burst(
        {
          position: [0, 0, z + 0.01],
          velocity: [0, 0, 0],
          velocitySpread: [0, 0, 0],
          lifetime: [100, 100],
          startSize: 0.02,
          endSize: 0.02,
          startColor: [0, 0, 1, 0.5],
          endColor: [0, 0, 1, 0.5],
          fadeOut: 0,
          shape: "square",
        },
        1,
      );
      stressTrail.addPoint(i % 2 ? 0.01 : -0.01, 0, z);
    }
    await draw(false);
    const stressResources = { ...app.renderer.resources.stats };
    const stressTimes = [];
    for (let i = 0; i < 35; i++) stressTimes.push((await draw(false)).cpu);
    const stress = {
      meshCount: 128,
      billboardCount: 128,
      ribbonCount: particles.trails.count,
      runs: app.renderer.transparency.count,
      drawCalls: app.renderer.stats.drawCalls,
      effectDrawCalls: app.renderer.stats.particleDrawCalls,
      uploadBytes: app.renderer.stats.particleUploadBytes,
      cpuMedianMs: stressTimes.sort(
        (a, b) => /** Order warmed stress durations for the median. */ a - b,
      )[17],
    };
    if (
      stress.runs !== 383 ||
      stress.drawCalls !== 383 ||
      stress.effectDrawCalls !== 255 ||
      stress.uploadBytes !== 144
    )
      throw new Error(
        `Incorrect alternating stress counters ${JSON.stringify(stress)}`,
      );
    if (
      JSON.stringify(stressResources) !==
      JSON.stringify(app.renderer.resources.stats)
    )
      throw new Error("Alternating alpha ranges allocated warm GPU objects");
    const finalResources = app.renderer.resources;
    await app.dispose();
    return {
      checks,
      stress,
      additivePixel: additiveImage.pixel,
      cpuMedianMs: timings.sort(
        (a, b) => /** Order diagnostic frame durations for the median. */ a - b,
      )[17],
      gpuErrors,
      finalBuffers: finalResources.stats.buffers,
      finalTextures: finalResources.stats.textures,
    };
  });
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(errors, []);
  assert.equal(report.finalBuffers, 0);
  assert.equal(report.finalTextures, 0);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/transparency.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
