import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { launchValidationBrowser } from "./gpu/validation-browser.mjs";
import { startPreviewServer } from "./gpu/preview-server.mjs";

const server = await startPreviewServer(5201, true);
let browser;
try {
  browser = await launchValidationBrowser();
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on("pageerror", (error) => {
    /* Capture asynchronous browser failures separately from expected registration rejection. */ errors.push(
      error.message,
    );
  });
  await page.goto("http://127.0.0.1:5201");
  await page.waitForFunction(() => {
    /* Wait for initialized application/GPU owners. */ return (
      window.rendererApp?.frames >= 3
    );
  });
  const report = await page.evaluate(async () => {
    // Exercise shader registration, all draw paths, recovery and warm resource reuse in the production bundle.
    const app = window.rendererApp,
      w = app.world;
    app.stop();
    const source = `
// Returns user-tinted linear base color without introducing custom coverage or deformation.
fn shadeMaterial(s: MaterialSurface, p: MaterialShaderParameters) -> vec3<f32> {
  return p.values[0].rgb + s.emissive;
}`;
    const identitySource = `
// Matches built-in PBR lighting for exact image references across shared render paths.
fn shadeMaterial(s: MaterialSurface, p: MaterialShaderParameters) -> vec3<f32> {
  if dot(s.normal, s.normal) <= 0.5 { return s.baseColor.rgb + s.emissive; }
  return directLighting(s.baseColor.rgb, s.metallic, s.roughness, s.normal, s.viewDirection,
    s.worldPosition, s.screenPosition) + ambientLighting(s.baseColor.rgb, s.metallic, s.roughness,
    s.normal, s.viewDirection, s.occlusion) + s.emissive;
}`;
    const ids = await Promise.all([
      app.registerMaterialShader({ name: "unlit", source }),
      app.registerMaterialShader({ name: "unlit", source }),
      app.registerMaterialShader({
        name: "pbr-reference",
        source: identitySource,
      }),
    ]);
    let rejected = false;
    try {
      await app.registerMaterialShader({
        name: "invalid",
        source:
          "fn shadeMaterial(s: MaterialSurface, p: MaterialShaderParameters) -> vec3<f32> { return missing_symbol; }",
      });
    } catch {
      rejected = true;
    }
    if (!rejected || app.materials.shaders.definitions.length !== 2)
      throw new Error("Failed WGSL registration was published");
    const material = app.materials.create({
      shaderId: ids[0],
      baseColor: [0.8, 0.2, 0.1, 1],
      shaderParameters: [0.8, 0.2, 0.1],
    });
    w.meshes.set(app.sceneEntity, 0, material);
    app.renderer.camera.setPosition(0, 0, 5);
    app.renderer.camera.setTarget(0, 0, 0);
    /** Updates the complete deformation/extraction sequence and reads pixels only in this diagnostic path. */
    async function draw(read = true) {
      const r = app.renderer,
        gpu = app.gpu,
        device = gpu.device;
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
      const texture = gpu.context.getCurrentTexture(),
        encoder = device.createCommandEncoder();
      const start = performance.now();
      r.encode(encoder, texture.createView({ format: gpu.renderFormat }));
      const cpu = performance.now() - start;
      const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
      let buffer;
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
      return { pixels, pixel, cpu, completion };
    }
    /** Counts mismatched bytes for exact reference images. */
    function difference(a, b) {
      let count = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
      return count;
    }
    const baseline = await draw();
    const expected = [0.8, 0.2, 0.1].map((v) => {
      /* Convert linear analytic RGB into the sRGB attachment's stored values. */ return Math.round(
        (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255,
      );
    });
    for (let i = 0; i < 3; i++)
      if (Math.abs(baseline.pixel[i] - expected[i]) > 1)
        throw new Error(
          `Incorrect custom linear color: ${JSON.stringify({ pixel: baseline.pixel, expected })}`,
        );
    const modes = [];
    for (const mode of ["individual", "sorted", "instanced", "gpu-indirect"]) {
      if (mode === "gpu-indirect" && !app.renderer.gpuDraws.supported) continue;
      app.renderer.submissionMode = mode;
      modes.push({
        mode,
        difference: difference(baseline.pixels, (await draw()).pixels),
      });
    }
    app.renderer.submissionMode = "instanced";
    app.renderer.depthPrepass.enabled = true;
    const depthDifference = difference(baseline.pixels, (await draw()).pixels);
    app.materials.set(material, {
      shaderId: ids[0],
      baseColor: [1, 1, 1, 0.5],
      alphaMode: "MASK",
      alphaCutoff: 0.75,
      shaderParameters: [0.8, 0.2, 0.1],
    });
    const masked = (await draw()).pixel;
    app.materials.set(material, {
      shaderId: ids[0],
      baseColor: [1, 1, 1, 0.5],
      alphaMode: "BLEND",
      shaderParameters: [0.8, 0.2, 0.1],
    });
    const blended = (await draw()).pixel;
    app.materials.set(material, {
      shaderId: ids[0],
      baseColor: [0.8, 0.2, 0.1, 1],
      shaderParameters: [0.8, 0.2, 0.1],
    });
    app.materials.setShaderParameters(material, [0, 1, 0]);
    const updated = (await draw()).pixel;
    const changedBytes = app.materials.shaderUploadBytes;
    await draw();
    const unchangedBytes = app.materials.shaderUploadBytes;
    app.materials.setShaderParameters(material, [0.8, 0.2, 0.1]);
    const faces = Array.from({ length: 6 }, () => {
      /* Supply a bounded constant environment cube. */ return new Float32Array(
        [0.25, 0.25, 0.25, 1],
      );
    });
    await app.renderer.setEnvironment({
      diffuse: { size: 1, faces },
      specular: [{ size: 1, faces }],
      brdf: { size: 1, pixels: new Float32Array([0.8, 0.05, 0, 1]) },
    });
    await draw(); // Environment setup precedes HDR to cover that resource preparation order.
    app.renderer.hdr.enabled = true;
    app.renderer.hdr.toneMapping = "clamp";
    const hdrPixel = (await draw()).pixel;
    await app.registerMaterialShader({ name: "late-unlit", source });
    app.renderer.environment.enabled = false;
    app.renderer.hdr.enabled = false;
    app.renderer.depthPrepass.enabled = false;
    // A PBR-equivalent custom family must preserve images for textured skin/morph assets and shadows.
    w.meshes.remove(app.sceneEntity);
    const textured = await app.instantiateAsset("/regression/pbr.glb");
    const asset = await app.instantiateAsset("/regression/crowd-combined.glb");
    if (asset.animator) {
      asset.animator.play();
      asset.animator.currentTime = 0.7;
    }
    const renderEntities = [];
    for (let e = 0; e < w.nextEntity; e++)
      if (w.alive[e] && w.meshes.has[e]) renderEntities.push(e);
    const originalMaterials = new Map();
    for (const e of renderEntities)
      originalMaterials.set(e, w.meshes.materialId[e]);
    app.renderer.shadows.enabled = true;
    app.renderer.shadows.cacheEnabled = false;
    w.lights.set(app.defaultLightEntity, {
      type: "directional",
      intensity: 3,
      direction: [-0.4, -0.6, -1],
      castShadow: true,
    });
    const reference = await draw();
    for (const id of new Set(originalMaterials.values()))
      app.materials.setShader(id, ids[2]);
    const deformationDifference = difference(
      reference.pixels,
      (await draw()).pixels,
    );
    const deformation = {
      joints: app.renderer.stats.jointCount,
      morphTargets: app.renderer.stats.morphTargets,
      shadowDrawCalls: app.renderer.stats.shadowDrawCalls,
    };
    app.renderer.depthPrepass.enabled = true;
    // Compare equivalent pass configurations: coplanar fixtures can change tie winners when depth prepass is enabled.
    for (const id of new Set(originalMaterials.values()))
      app.materials.setShader(id, 0);
    const depthReference = await draw();
    for (const id of new Set(originalMaterials.values()))
      app.materials.setShader(id, ids[2]);
    const deformationDepthDifference = difference(
      depthReference.pixels,
      (await draw()).pixels,
    );
    app.renderer.depthPrepass.enabled = false;
    if (app.renderer.gpuDraws.supported)
      app.renderer.submissionMode = "gpu-indirect";
    for (const id of new Set(originalMaterials.values()))
      app.materials.setShader(id, 0);
    const indirectReference = await draw();
    for (const id of new Set(originalMaterials.values()))
      app.materials.setShader(id, ids[2]);
    const deformationIndirectDifference = difference(
      indirectReference.pixels,
      (await draw()).pixels,
    );
    app.renderer.submissionMode = "instanced";
    await asset.dispose();
    await textured.dispose();
    app.renderer.shadows.enabled = false;
    // One thousand shared cubes isolate family dispatch overhead with one instanced batch.
    w.meshes.set(app.sceneEntity, 0, material);
    app.renderer.camera.setPosition(0, 0, 60);
    app.renderer.camera.setTarget(0, 0, 0);
    app.renderer.camera.setOrthographic({ height: 36, near: 0.1, far: 100 });
    w.transforms.setScale(app.sceneEntity, 0.2, 0.2, 0.2);
    const cubes = [];
    for (let i = 0; i < 999; i++) {
      const e = w.create();
      cubes.push(e);
      w.transforms.add(e);
      w.transforms.setPosition(
        e,
        ((i % 32) - 16) * 0.8,
        (Math.floor(i / 32) - 16) * 0.8,
        0,
      );
      w.transforms.setScale(e, 0.2, 0.2, 0.2);
      w.meshes.set(e, 0, material);
      w.bounds.setSphere(e, 0, 0, 0, Math.sqrt(3));
    }
    /** Returns the middle timing sample for this equivalent-workload benchmark. */
    function median(values) {
      return values.sort((a, b) => {
        /* Sort numeric timing samples. */ return a - b;
      })[Math.floor(values.length / 2)];
    }
    const timings = [];
    for (const shaderId of [0, ids[2], ids[0]]) {
      app.materials.set(material, {
        shaderId,
        baseColor: [0.8, 0.2, 0.1, 1],
        shaderParameters: [0.8, 0.2, 0.1],
      });
      for (let i = 0; i < 10; i++) await draw(false);
      const before = { ...app.renderer.resources.stats },
        samples = [];
      for (let i = 0; i < 40; i++) samples.push(await draw(false));
      const after = { ...app.renderer.resources.stats };
      timings.push({
        shaderId,
        cpuMedianMs: median(
          samples.map((s) => {
            /* Select CPU encoding timings. */ return s.cpu;
          }),
        ),
        completionMedianMs: median(
          samples.map((s) => {
            /* Select diagnostic GPU-fenced completion timings. */ return s.completion;
          }),
        ),
        drawCalls: app.renderer.stats.drawCalls,
        instances: app.renderer.stats.instances,
        unchanged: JSON.stringify(before) === JSON.stringify(after),
        parameterUploadBytes: app.materials.shaderUploadBytes,
      });
    }
    // Mixed families retain two batches rather than falling back to one draw per entity.
    const other = app.materials.create({ shaderId: ids[2] });
    for (let i = 0; i < cubes.length; i++)
      if (i % 2 === 0) w.meshes.set(cubes[i], 0, other);
    await draw(false);
    const mixedDrawCalls = app.renderer.stats.drawCalls;
    for (const e of cubes) w.destroy(e);
    app.materials.set(material, {
      shaderId: ids[0],
      baseColor: [0.8, 0.2, 0.1, 1],
      shaderParameters: [0.8, 0.2, 0.1],
    });
    const beforeRecovery = await draw();
    app.autoRecoverDevice = false;
    app.gpu.device.destroy();
    await app.gpu.device.lost;
    await app.recoverDevice(false);
    const recoveryDifference = difference(
      beforeRecovery.pixels,
      (await draw()).pixels,
    );
    const warmBefore = { ...app.renderer.resources.stats };
    for (let i = 0; i < 10; i++) await draw(false);
    const warmStable =
      JSON.stringify(warmBefore) ===
      JSON.stringify(app.renderer.resources.stats);
    const gpuErrors = app.gpu.errors.slice();
    await app.dispose();
    return {
      ids,
      rejected,
      pixel: baseline.pixel,
      expected,
      modes,
      depthDifference,
      masked,
      blended,
      updated,
      changedBytes,
      unchangedBytes,
      hdrPixel,
      deformationDifference,
      deformationDepthDifference,
      deformationIndirectDifference,
      deformation,
      timings,
      mixedDrawCalls,
      recoveryDifference,
      warmStable,
      gpuErrors,
      finalBuffers: app.renderer.resources.stats.buffers,
    };
  });
  assert.equal(report.ids[0], report.ids[1]);
  assert(report.rejected);
  for (const row of report.modes) assert.equal(row.difference, 0);
  for (const key of [
    "depthDifference",
    "deformationDifference",
    "deformationDepthDifference",
    "deformationIndirectDifference",
    "recoveryDifference",
  ])
    assert.equal(report[key], 0, key);
  assert.notDeepEqual(report.masked.slice(0, 3), report.pixel.slice(0, 3));
  assert.notDeepEqual(report.blended.slice(0, 3), report.pixel.slice(0, 3));
  assert.notDeepEqual(report.blended.slice(0, 3), report.masked.slice(0, 3));
  assert.equal(report.updated[0], 0);
  assert.equal(report.updated[2], 0);
  assert.equal(report.changedBytes, 64);
  assert.equal(report.unchangedBytes, 0);
  for (let i = 0; i < 3; i++)
    assert(Math.abs(report.hdrPixel[i] - report.expected[i]) <= 1);
  assert(report.deformation.joints > 0);
  assert(report.deformation.morphTargets > 0);
  assert(report.deformation.shadowDrawCalls > 0);
  for (const row of report.timings) {
    assert(row.unchanged);
    assert.equal(row.drawCalls, 1);
    assert.equal(row.instances, 1000);
    assert.equal(row.parameterUploadBytes, 0);
  }
  assert.equal(report.mixedDrawCalls, 2);
  assert(report.warmStable);
  assert.equal(report.finalBuffers, 0);
  assert.deepEqual(report.gpuErrors, []);
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/material-shaders.json",
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
