import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { launchValidationBrowser } from "./gpu/validation-browser.mjs";
import { startPreviewServer } from "./gpu/preview-server.mjs";
const server = await startPreviewServer(5219, true);
let browser;
try {
  browser = await launchValidationBrowser();
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.goto("http://127.0.0.1:5219");
  await page.waitForFunction(() => {
    // Wait for complete production initialization before the isolated transmission scene.
    return window.rendererApp?.frames >= 3;
  });
  const report = await page.evaluate(async () => {
    // Analytic references, readbacks and fences are diagnostics, outside production frame processing.
    const app = window.rendererApp;
    app.stop();
    const w = app.world,
      errors = [];
    const watch = () => {
      // Capture validation errors on both original and recovered devices.
      app.gpu.device.addEventListener("uncapturederror", (event) => {
        // Record asynchronous GPU errors without replacing test assertions.
        errors.push(event.error.message);
      });
    };
    watch();
    w.meshes.remove(app.sceneEntity);
    w.lights.remove(app.defaultLightEntity);
    app.renderer.camera.setPosition(0, 0, 5);
    app.renderer.camera.setTarget(0, 0, 0);
    app.renderer.camera.setOrthographic({ height: 4, near: 0.1, far: 100 });
    app.renderer.clearColor = { r: 0.25, g: 0.5, b: 0.75, a: 1 };
    const material = app.materials.create({
      baseColor: [1, 1, 1, 1],
      metallic: 0,
      roughness: 0,
      ior: 1,
      transmission: 1,
      thickness: 1,
      attenuationColor: [0.5, 0.25, 1],
      attenuationDistance: 1,
    });
    const mesh = app.renderer.meshes.upload({
      mode: 4,
      material,
      indices: new Uint32Array([0, 1, 2]),
      targets: [],
      attributes: {
        POSITION: new Float32Array([-2, -2, 0, 2, -2, 0, 0, 2, 0]),
        NORMAL: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        TEXCOORD_0: new Float32Array([0.25, 0.5, 0.25, 0.5, 0.25, 0.5]),
        TEXCOORD_1: new Float32Array([0.875, 0.5, 0.875, 0.5, 0.875, 0.5]),
      },
    });
    const entity = w.create();
    w.transforms.add(entity);
    w.meshes.set(entity, mesh, material);
    w.bounds.setAABB(entity, [-2, -2, 0], [2, 2, 0]);
    const draw = async () => {
      // Render using current owners after recovery, then read the completed presentation.
      app.transformSystem.update(w.transforms);
      app.extractor.extract(
        w,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
      const r = app.renderer,
        d = app.gpu.device,
        texture = app.gpu.context.getCurrentTexture(),
        encoder = d.createCommandEncoder(),
        start = performance.now();
      r.encode(encoder, texture.createView({ format: app.gpu.renderFormat }));
      const cpu = performance.now() - start;
      const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256,
        buffer = d.createBuffer({
          size: bytesPerRow * texture.height,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
        texture.width,
        texture.height,
      ]);
      app.gpu.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const bytes = new Uint8Array(buffer.getMappedRange()).slice(),
        o =
          Math.floor(texture.height / 2) * bytesPerRow +
          Math.floor(texture.width / 2) * 4,
        pixel = Array.from(bytes.slice(o, o + 4));
      if (app.gpu.format.startsWith("bgra"))
        [pixel[0], pixel[2]] = [pixel[2], pixel[0]];
      buffer.unmap();
      buffer.destroy();
      return { bytes, pixel, cpu, completion: performance.now() - start };
    };
    const expected = (linear) => {
      // Convert linear radiance to the configured sRGB presentation reference.
      return linear.map((v) => {
        // Quantize the standard piecewise sRGB transfer function.
        return Math.round(
          (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255,
        );
      });
    };
    const check = (sample, linear, label) => {
      // Half-float storage and final presentation may differ by at most two output codes.
      const reference = expected(linear);
      for (let i = 0; i < 3; i++)
        if (Math.abs(sample.pixel[i] - reference[i]) > 2)
          throw new Error(
            label + ": " + JSON.stringify({ actual: sample.pixel, reference }),
          );
    };
    app.renderer.transmission.enabled = true;
    const volume = await draw();
    check(volume, [0.125, 0.125, 0.75], "Beer-Lambert one-distance absorption");
    const values = {
      baseColor: [1, 1, 1, 1],
      metallic: 0,
      roughness: 0,
      ior: 1,
      transmission: 1,
      thickness: 0,
    };
    app.materials.set(material, values);
    const thin = await draw();
    check(thin, [0.25, 0.5, 0.75], "Thin-surface transmission");
    app.materials.set(material, {
      ...values,
      thickness: 1,
      attenuationColor: [0.5, 0.25, 1],
      attenuationDistance: 1,
    });
    w.transforms.setScale(entity, 2, 2, 2);
    const scaled = await draw();
    check(scaled, [0.0625, 0.03125, 0.75], "Scaled baked thickness");
    w.transforms.setScale(entity, 1, 1, 1);
    // A procedural opaque screen gradient provides an analytic refracted lookup reference.
    const shaderId = await app.renderer.registerMaterialShader({
      name: "Transmission gradient reference",
      source: `
// Author a deterministic opaque red gradient in normalized screen coordinates.
fn shadeMaterial(surface:MaterialSurface,parameters:MaterialShaderParameters)->vec3<f32> {return vec3<f32>(surface.screenPosition.x/frame.viewport.x,0.0,0.0);}`,
    });
    const backgroundMaterial = app.materials.create({
        shaderId,
        baseColor: [1, 1, 1, 1],
      }),
      backgroundMesh = app.renderer.meshes.upload({
        mode: 4,
        material: backgroundMaterial,
        indices: new Uint32Array([0, 1, 2]),
        targets: [],
        attributes: {
          POSITION: new Float32Array([-4, -3, -1, 4, -3, -1, 0, 5, -1]),
        },
      }),
      backgroundEntity = w.create();
    w.transforms.add(backgroundEntity);
    w.meshes.set(backgroundEntity, backgroundMesh, backgroundMaterial);
    w.bounds.setAABB(backgroundEntity, [-4, -3, -1], [4, 5, -1]);
    const tiltedMesh = app.renderer.meshes.upload({
      mode: 4,
      material,
      indices: new Uint32Array([0, 1, 2]),
      targets: [],
      attributes: {
        POSITION: new Float32Array([-2, -2, 0, 2, -2, 0, 0, 2, 0]),
        NORMAL: new Float32Array([0.6, 0, 0.8, 0.6, 0, 0.8, 0.6, 0, 0.8]),
      },
    });
    w.meshes.meshId[entity] = tiltedMesh;
    app.materials.set(material, { ...values, ior: 1.5, thickness: 1 });
    const refracted = await draw();
    const dot = 0.8,
      eta = 1 / 1.5,
      root = Math.sqrt(1 - eta * eta * (1 - dot * dot)),
      rx = -(root - eta * dot) * 0.6,
      rayX = rx / root;
    const fresnel = 0.04 + 0.96 * (1 - dot) ** 5;
    check(
      refracted,
      [
        ((640 / 2 + 0.5) / 640 + rayX / ((4 * 640) / 480)) * (1 - fresnel),
        0,
        0,
      ],
      "IOR-based screen refraction",
    );
    app.materials.set(material, { ...values, ior: 1.5, thickness: 0 });
    const unrefracted = await draw();
    if (refracted.pixel[0] >= unrefracted.pixel[0] - 3)
      throw new Error("Baked thickness did not shift opaque background lookup");
    w.destroy(backgroundEntity);
    w.meshes.meshId[entity] = mesh;
    app.materials.set(material, {
      ...values,
      thickness: 1,
      attenuationColor: [0.5, 0.25, 1],
      attenuationDistance: 1,
    });
    const png = async (width, height, pixels) => {
      // Encode authored mask channels without relying on remote fixtures or external image decoders.
      const canvas = new OffscreenCanvas(width, height),
        context = canvas.getContext("2d");
      context.putImageData(
        new ImageData(new Uint8ClampedArray(pixels), width, height),
        0,
        0,
      );
      return new Uint8Array(
        await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
      );
    };
    const tPixels = new Uint8Array([128, 255, 0, 255, 255, 0, 0, 255]),
      hPixels = new Uint8Array(4 * 2 * 4);
    for (let i = 0; i < 8; i++)
      hPixels.set([255, i % 4 === 3 ? 128 : 0, 0, 255], i * 4);
    const slot = (texture, texCoord) => {
      // Preserve independent nearest/no-mip authored samplers for the normalized packed-array test.
      return {
        texture,
        texCoord,
        magFilter: 9728,
        minFilter: 9728,
        wrapS: 33071,
        wrapT: 33071,
      };
    };
    const asset = {
      textures: [
        {
          name: "Transmission mask",
          mimeType: "image/png",
          image: await png(2, 1, tPixels),
        },
        {
          name: "Thickness mask",
          mimeType: "image/png",
          image: await png(4, 2, hPixels),
        },
      ],
      materials: [
        { textures: { transmission: slot(0, 0), thickness: slot(1, 1) } },
      ],
    };
    const groups = await app.renderer.textures.prepare(asset);
    app.renderer.textures.groups[material] = groups[0];
    app.materials.setTextureSlots(material, asset.materials[0].textures);
    const mapped = await draw(),
      amount = 128 / 255,
      path = 128 / 255;
    check(
      mapped,
      [
        0.25 * 0.5 ** path * amount + 0.03 * (1 - amount),
        0.5 * 0.25 ** path * amount + 0.03 * (1 - amount),
        0.75 * amount + 0.03 * (1 - amount),
      ],
      "Packed channels/independent UV and sampler selection",
    );
    app.materials.setTextureSlots(material, {
      ...asset.materials[0].textures,
      transmission: {
        ...asset.materials[0].textures.transmission,
        offset: [0.5, 0],
      },
    });
    const transformed = await draw();
    check(
      transformed,
      [0.25 * 0.5 ** path, 0.5 * 0.25 ** path, 0.75],
      "Independent authored transmission transform",
    );
    app.materials.setTextureSlots(material, asset.materials[0].textures);
    const misses = app.renderer.textures.metrics.misses;
    const shared = await app.renderer.textures.prepare(asset);
    if (app.renderer.textures.metrics.misses !== misses)
      throw new Error("Packed volume maps did not deduplicate");
    await app.renderer.textures.release(shared);
    await draw();
    const warm = { ...app.renderer.resources.stats },
      timings = [];
    for (let i = 0; i < 30; i++) {
      const sample = await draw();
      timings.push({ cpuMs: sample.cpu, completionMs: sample.completion });
    }
    if (JSON.stringify(warm) !== JSON.stringify(app.renderer.resources.stats))
      throw new Error("Warm transmission created GPU objects");
    app.renderer.antialiasing = "taa";
    app.renderer.taa.jitter = false;
    await draw();
    const temporal = await draw();
    check(
      temporal,
      [
        0.25 * 0.5 ** path * amount + 0.03 * (1 - amount),
        0.5 * 0.25 ** path * amount + 0.03 * (1 - amount),
        0.75 * amount + 0.03 * (1 - amount),
      ],
      "TAA reactive transmission",
    );
    const backgroundBytes =
        app.renderer.transmission.backgroundTexture.width *
        app.renderer.transmission.backgroundTexture.height *
        8,
      mips = app.renderer.stats.transmissionMipPasses;
    const reference = await draw();
    await app.recoverDevice();
    app.stop();
    watch();
    const recovered = await draw();
    let recoveryDifference = 0;
    for (let i = 0; i < reference.bytes.length; i++)
      recoveryDifference += Number(reference.bytes[i] !== recovered.bytes[i]);
    if (recoveryDifference || !app.renderer.transmission.enabled)
      throw new Error(
        "Transmission recovery changed pixels/settings: " +
          JSON.stringify({
            recoveryDifference,
            reference: reference.pixel,
            recovered: recovered.pixel,
            enabled: app.renderer.transmission.enabled,
            errors,
          }),
      );
    const cube = (size) => {
      // Zero-radiance cubemaps test the maximum material/environment binding layout without changing analytic color.
      return {
        size,
        faces: Array.from({ length: 6 }, () => {
          // Allocate one cold retained environment face for each cube direction.
          return new Float32Array(size * size * 4);
        }),
      };
    };
    await app.renderer.setEnvironment({
      diffuse: cube(1),
      specular: [cube(1)],
      brdf: { size: 1, pixels: new Float32Array([0, 0, 0, 1]) },
    });
    await draw();
    const environmentWarm = { ...app.renderer.resources.stats };
    await draw();
    if (
      JSON.stringify(environmentWarm) !==
      JSON.stringify(app.renderer.resources.stats)
    )
      throw new Error("Warm environment transmission created GPU objects");
    const resources = app.renderer.resources;
    await app.dispose();
    return {
      refracted: refracted.pixel,
      unrefracted: unrefracted.pixel,
      transformed: transformed.pixel,
      volume: volume.pixel,
      thin: thin.pixel,
      scaled: scaled.pixel,
      mapped: mapped.pixel,
      temporal: temporal.pixel,
      recoveryDifference,
      mips,
      backgroundBaseBytes: backgroundBytes,
      timings,
      errors,
      finalBuffers: resources.stats.buffers,
      finalTextures: resources.stats.textures,
    };
  });
  assert.deepEqual(report.errors, []);
  assert.equal(report.finalBuffers, 0);
  assert.equal(report.finalTextures, 0);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/transmission.json",
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
