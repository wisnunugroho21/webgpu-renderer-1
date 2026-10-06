import { authoredFixture } from "./gpu/authored-fixture.mjs";
import { launchValidationBrowser } from "./gpu/validation-browser.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";
await mkdir("artifacts", { recursive: true });
await authoredFixture("dist/regression/authored.glb");
const server = await startPreviewServer(5198, true);
let browser;
try {
  browser = await launchValidationBrowser();
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on("pageerror", (error) =>
    /** Collect asynchronous browser failures independently of GPU scopes. */ errors.push(
      error.message,
    ),
  );
  await page.goto("http://127.0.0.1:5198");
  await page.waitForFunction(
    () =>
      /** Wait for the production application to finish initialization. */ window
        .rendererApp?.frames >= 3,
  );
  const report = await page.evaluate(async () => {
    // Exercise local shadows and authored material behavior with diagnostic readbacks.

    const app = window.rendererApp,
      r = app.renderer,
      w = app.world,
      device = app.gpu.device;
    const materialWords = app.materials.data.length / app.materials.capacity;
    app.stop();
    device.pushErrorScope("validation");
    /** Prepares the current scene, submits GPU work and reads pixels only for this diagnostic scenario. */
    const draw = async (owner = r) => {
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
      owner.encode(
        encoder,
        texture.createView({ format: app.gpu.renderFormat }),
      );
      const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
      const buffer = device.createBuffer({
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
    /** Compares diagnostic pixel buffers and reports their differing values. */
    const difference = (a, b) => {
      let count = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
      return count;
    };

    w.destroy(app.sceneEntity);
    w.destroy(app.defaultLightEntity);
    r.camera.setPosition(0, 0, 6);
    r.camera.setTarget(0, 0, 0);
    r.shadows.enabled = true;
    r.shadows.cacheEnabled = true;
    const material = app.materials.create({
      baseColor: [0.7, 0.7, 0.7, 1],
      roughness: 0.7,
      doubleSided: true,
    });
    const mesh = r.meshes.upload({
      attributes: {
        POSITION: new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]),
        NORMAL: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      },
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      mode: 4,
      material: 0,
      targets: [],
    });
    for (const scale of [1, 0.18]) {
      const e = w.create();
      w.transforms.add(e);
      w.transforms.setScale(e, scale, scale, scale);
      w.transforms.setPosition(e, 0, 0, scale === 1 ? 0 : 1);
      w.meshes.set(e, mesh, material);
      w.bounds.setSphere(e, 0, 0, 0, 3);
    }
    const light = w.create();
    w.transforms.add(light);
    w.transforms.setPosition(light, 0.7, 0, 3);
    const results = {};
    for (const type of ["spot", "point"]) {
      w.lights.set(light, {
        type,
        range: 10,
        intensity: 25,
        direction: [0, 0, -1],
        outerCone: 0.7,
        castShadow: false,
      });
      const off = await draw();
      w.lights.castShadow[light] = 1;
      const on = await draw(),
        passes = r.stats.shadowPasses;
      const warm = await draw(),
        cacheHits = r.stats.shadowCacheHits;
      r.shadows.cullingEnabled = false;
      r.shadows.cacheEnabled = false;
      const uncull = await draw();
      r.shadows.cullingEnabled = true;
      const resources = { ...r.resources.stats };
      const timings = [];
      for (let i = 0; i < 40; i++) {
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
        if (i >= 20)
          timings.push({ cpu, completion: performance.now() - start });
      }
      const median = (key) =>
        /** Return a median after excluding warm-up samples. */ timings
          .map(
            (row) =>
              /** Select and sort timing samples for this diagnostic statistic. */ row[
                key
              ],
          )
          .sort(
            (a, b) =>
              /** Select and sort timing samples for this diagnostic statistic. */ a -
              b,
          )[10];
      results[type] = {
        difference: difference(off, on),
        warmDifference: difference(on, warm),
        cullingDifference: difference(on, uncull),
        passes,
        cacheHits,
        cpuMs: median("cpu"),
        completionMs: median("completion"),
        resourcesBefore: resources,
        resourcesAfter: { ...r.resources.stats },
      };
      r.shadows.cacheEnabled = true;
    }

    // Compare a reduced viewport against an independent physically smaller shadow array.
    r.shadows.budget.configure({ maxLayers: 6, maxTexels: 6 * 256 * 256 });
    r.shadows.budget.enabled = true;
    const budgetImage = await draw();
    const budget = {
      passes: r.stats.shadowPasses,
      texels: r.stats.shadowBudgetTexels,
      scale: r.shadows.data[19],
    };
    const independent = new r.constructor(
      app.gpu,
      app.renderWorld,
      app.materials,
      app.profiler,
      undefined,
      app.particles,
      { shadows: { resolution: 256, layers: 6 } },
    );
    r.meshes.rebuildInto(independent.meshes);
    independent.camera.copyFrom(r.camera);
    app.renderWorld.lightDirty.fill(1); // The diagnostic second owner needs an initial shared-light upload.
    const independentImage = await draw(independent);
    budget.independentDifference = difference(budgetImage, independentImage);
    budget.targetBytes =
      independent.shadows.texture.width *
      independent.shadows.texture.height *
      independent.shadows.texture.depthOrArrayLayers *
      4;
    await app.gpu.queue.onSubmittedWorkDone();
    independent.dispose();
    const budgetResources = { ...r.resources.stats };
    await draw();
    await draw();
    budget.cacheHits = r.stats.shadowCacheHits;
    budget.warmResources = { ...r.resources.stats };
    budget.resourcesBefore = budgetResources;
    r.shadows.cacheEnabled = false;
    const budgetTimings = [];
    for (let frame = 0; frame < 30; frame++) {
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
      if (frame >= 10)
        budgetTimings.push({ cpu, completion: performance.now() - start });
    }
    budget.cpuMedianMs = budgetTimings
      .map(
        (row) =>
          /** Select CPU durations without diagnostic image copies. */ row.cpu,
      )
      .sort((a, b) => /** Order warmed CPU samples. */ a - b)[10];
    budget.completionMedianMs = budgetTimings
      .map(
        (row) =>
          /** Include GPU completion in diagnostic durations. */ row.completion,
      )
      .sort((a, b) => /** Order warmed completion samples. */ a - b)[10];
    r.shadows.cacheEnabled = true;
    r.shadows.budget.configure({ maxLayers: 5 });
    await draw();
    budget.rejected = r.stats.shadowBudgetRejected;
    budget.rejectedPasses = r.stats.shadowPasses;
    r.shadows.budget.enabled = false;
    // Factor-only materials isolate Fresnel, coat layering, emission and unlit behavior.
    r.shadows.enabled = false;
    const factors = {};
    app.materials.set(material, {
      baseColor: [0.3, 0.4, 0.5, 1],
      roughness: 0.2,
      doubleSided: true,
    });
    const reference = await draw();
    for (const [name, properties] of Object.entries({
      ior: { ior: 2.42 },
      specular: { specular: 0 },
      specularColor: { specularColor: [4, 0.2, 0.2] },
      clearcoat: { clearcoat: 1, clearcoatRoughness: 0.08 },
      emission: { emissive: [0.3, 0.1, 0.02], emissiveStrength: 3 },
    })) {
      app.materials.set(material, {
        baseColor: [0.3, 0.4, 0.5, 1],
        roughness: 0.2,
        doubleSided: true,
        ...properties,
      });
      factors[name] = difference(reference, await draw());
    }
    app.materials.set(material, {
      unlit: true,
      baseColor: [0.25, 0.5, 0.75, 1],
      emissive: [10, 10, 10],
      doubleSided: true,
    });
    const unlit = await draw();
    w.lights.intensity[light] = 0;
    factors.unlitLightDifference = difference(unlit, await draw());
    app.materials.set(material, {
      unlit: true,
      baseColor: [0.25, 0.5, 0.75, 1],
      doubleSided: true,
    });
    factors.unlitEmissionDifference = difference(unlit, await draw());
    for (let e = 0; e < w.capacity; e++) if (w.meshes.has[e]) w.destroy(e);
    w.lights.intensity[light] = 25;
    await app.loadAsset("/regression/authored.glb");
    const authored = await draw(),
      authoredId = app.renderWorld.materialId[0],
      original = r.materials.data.slice(
        authoredId * materialWords,
        (authoredId + 1) * materialWords,
      );
    const authoredMaps = {};
    // Compare each authored map against its neutral fallback while retaining factors and UV rows.
    const layout = app.materials.textureLayout(authoredId, true);
    for (const [index, name] of [
      "clearcoat",
      "clearcoatRoughness",
      "clearcoatNormal",
      "specular",
      "specularColor",
    ].entries()) {
      const disabled = layout.slice();
      disabled[disabled.length - 1] &= ~(1 << index);
      app.materials.setTextureLayout(authoredId, disabled);
      authoredMaps[name] = difference(authored, await draw());
    }
    app.materials.setTextureLayout(authoredId, layout);
    factors.authoredRestoreDifference = difference(authored, await draw());

    // Compare textured lobes against equivalent factor-only values to catch incorrect channels or sRGB decoding.
    const saved = app.materials.data.slice(
      authoredId * materialWords,
      (authoredId + 1) * materialWords,
    );
    const o = authoredId * materialWords;
    const linear = (x) => {
      // Convert encoded sRGB bytes to the linear reference used by the shader.

      const v = x / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    app.materials.data[o + 27] *= 192 / 255;
    app.materials.data[o + 28] *= 128 / 255;
    app.materials.data[o + 21] *= 128 / 255;
    for (let i = 0; i < 3; i++)
      app.materials.data[o + 24 + i] *= linear([128, 192, 255][i]);
    const equivalent = layout.slice();
    equivalent[equivalent.length - 1] = 4;
    app.materials.setTextureLayout(authoredId, equivalent);
    const channelReference = await draw();
    factors.channelReferenceDifference = difference(authored, channelReference);
    factors.channelReferenceMaxError = 0;
    for (let i = 0; i < authored.length; i++)
      factors.channelReferenceMaxError = Math.max(
        factors.channelReferenceMaxError,
        Math.abs(authored[i] - channelReference[i]),
      );
    app.materials.data.set(saved, o);
    app.materials.setTextureLayout(authoredId, layout);
    // Base-map transforms must agree between color and depth-only alpha tests.
    r.depthPrepass.enabled = true;
    const withDepth = await draw();
    r.depthPrepass.enabled = false;
    factors.depthMaskDifference = difference(withDepth, await draw());
    const movedUV = layout.slice();
    movedUV[8] += 0.25;
    app.materials.setTextureLayout(authoredId, movedUV);
    factors.transformDifference = difference(authored, await draw());
    r.depthPrepass.enabled = true;
    const transformedDepth = await draw();
    r.depthPrepass.enabled = false;
    factors.transformedDepthDifference = difference(
      transformedDepth,
      await draw(),
    );
    app.materials.setTextureLayout(authoredId, layout);
    // Renderer streaming replaces and restores complete transform/map metadata while preserving scalar factors.
    await r.streaming.bindMaterial(
      authoredId,
      "authored-maps",
      async () =>
        /** Reuse the decoded authored asset for a streamed texture replacement. */ app.assets.loader.records.get(
          "/regression/authored.glb",
        ).decoded,
    );
    r.streaming.releaseMaterial(authoredId);
    factors.streamRestoreDifference = difference(authored, await draw());
    factors.streamLayoutDifference = difference(
      new Uint8Array(layout.buffer),
      new Uint8Array(app.materials.textureLayout(authoredId, true).buffer),
    );
    const modeImages = [];
    for (const mode of [
      "individual",
      "sorted",
      "instanced",
      ...(r.gpuDraws.supported ? ["gpu-indirect"] : []),
    ]) {
      r.submissionMode = mode;
      modeImages.push({ mode, difference: difference(authored, await draw()) });
    }
    r.submissionMode = "instanced";
    // Exercise authored lobes with HDR environment lighting before recovering that configuration.
    const cube = (size) => {
      // Supply constant linear radiance faces for an independent environment reference.
      return {
        size,
        faces: Array.from({ length: 6 }, () => {
          // Populate one cube face with the same HDR radiance at every texel.
          const pixels = new Float32Array(size * size * 4);
          for (let i = 0; i < pixels.length; i += 4)
            pixels.set([0.4, 0.3, 0.2, 1], i);
          return pixels;
        }),
      };
    };
    const lut = new Float32Array(16);
    for (let i = 0; i < 16; i += 4) lut.set([0.8, 0.05, 0, 1], i);
    await r.setEnvironment({
      diffuse: cube(2),
      specular: [cube(4), cube(2), cube(1)],
      brdf: { size: 2, pixels: lut },
    });
    r.hdr.enabled = true;
    const environmentImage = await draw();
    factors.environmentDifference = difference(authored, environmentImage);
    app.materials.data[o + 27] = 0;
    app.materials.setTextureLayout(authoredId, layout);
    factors.environmentCoatDifference = difference(
      environmentImage,
      await draw(),
    );
    app.materials.data.set(saved, o);
    app.materials.setTextureLayout(authoredId, layout);
    factors.environmentRestoreDifference = difference(
      environmentImage,
      await draw(),
    );
    // Device recovery rebuilds authored texture groups without resetting CPU materials or light components.
    const validationError = await device.popErrorScope(),
      oldErrors = [...app.gpu.errors];
    app.gpu.device.destroy();
    await app.recoverDevice();
    // Recovery retains r's CPU owners but replaces the renderer/device; read pixels with the new owners.
    const next = app.renderer,
      nd = app.gpu.device,
      encoder = nd.createCommandEncoder();
    const texture = app.gpu.context.getCurrentTexture();
    next.encode(encoder, texture.createView({ format: app.gpu.renderFormat }));
    const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256,
      read = nd.createBuffer({
        size: bytesPerRow * texture.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    encoder.copyTextureToBuffer({ texture }, { buffer: read, bytesPerRow }, [
      texture.width,
      texture.height,
    ]);
    nd.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const recovered = new Uint8Array(read.getMappedRange()).slice();
    read.unmap();
    read.destroy();
    factors.recoveryDifference = difference(environmentImage, recovered);
    factors.recoveryMaterialDifference = difference(
      new Uint8Array(original.buffer),
      new Uint8Array(
        next.materials.data.slice(
          authoredId * materialWords,
          (authoredId + 1) * materialWords,
        ).buffer,
      ),
    );
    return {
      results,
      budget,
      factors,
      authoredMaps,
      modeImages,
      gpuError: validationError?.message ?? null,
      errors: [...oldErrors, ...app.gpu.errors],
    };
  });
  assert.equal(report.budget.passes, 6);
  assert.equal(report.budget.texels, 6 * 256 * 256);
  assert.equal(report.budget.scale, 0.25);
  assert.equal(report.budget.independentDifference, 0);
  assert.equal(report.budget.targetBytes, 256 * 256 * 6 * 4);
  assert.equal(report.budget.cacheHits, 6);
  assert.equal(report.budget.rejected, 1);
  assert.equal(report.budget.rejectedPasses, 0);
  assert.deepEqual(report.budget.resourcesBefore, report.budget.warmResources);
  for (const [type, row] of Object.entries(report.results)) {
    assert.ok(row.difference > 100, type);
    assert.equal(row.passes, type === "point" ? 6 : 1);
    assert.equal(row.cacheHits, row.passes);
    assert.equal(row.warmDifference, 0);
    assert.equal(row.cullingDifference, 0);
    for (const key of [
      "bufferCreations",
      "textureCreations",
      "pipelineCreations",
      "shaderModules",
      "samplerCreations",
    ])
      assert.equal(row.resourcesBefore[key], row.resourcesAfter[key]);
  }
  for (const name of [
    "ior",
    "specular",
    "specularColor",
    "clearcoat",
    "emission",
  ])
    assert.ok(report.factors[name] > 0, name);
  for (const name of [
    "unlitLightDifference",
    "unlitEmissionDifference",
    "authoredRestoreDifference",
    "recoveryDifference",
    "recoveryMaterialDifference",
    "depthMaskDifference",
    "transformedDepthDifference",
    "streamRestoreDifference",
    "streamLayoutDifference",
    "environmentRestoreDifference",
  ])
    assert.equal(report.factors[name], 0, name);
  // Hardware sRGB conversion and JS reference arithmetic may quantize a few channels by one byte.
  assert.ok(report.factors.channelReferenceMaxError <= 1);
  assert.ok(report.factors.channelReferenceDifference < 640 * 480 * 0.001);
  assert.ok(report.factors.transformDifference > 0);
  assert.ok(report.factors.environmentDifference > 0);
  assert.ok(report.factors.environmentCoatDifference > 0);
  for (const [name, value] of Object.entries(report.authoredMaps))
    assert.ok(value > 0, name);
  for (const row of report.modeImages)
    assert.equal(row.difference, 0, row.mode);
  assert.equal(report.gpuError, null);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(errors, []);
  await writeFile(
    "benchmarks/results/authored-rendering-gpu.json",
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
