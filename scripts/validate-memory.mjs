import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startPreviewServer } from "./gpu/preview-server.mjs";
const server = await startPreviewServer(5211, true);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on("pageerror", (error) => {
    /* Record browser failures without hiding GPU validation failures. */ errors.push(
      error.message,
    );
  });
  await page.goto("http://127.0.0.1:5211");
  await page.waitForFunction(() => {
    /* Wait for complete application initialization. */ return (
      window.rendererApp?.frames >= 3
    );
  });
  const report = await page.evaluate(async () => {
    // All readbacks/fences and browser fixtures belong to this cold diagnostic scenario.
    const app = window.rendererApp;
    app.stop();
    const gpuErrors = [];
    /** Watch each device, including the recovered owner. */
    function watch() {
      app.gpu.device.addEventListener("uncapturederror", (event) => {
        /* Keep validation failures observable. */ gpuErrors.push(
          event.error.message,
        );
      });
    }
    watch();
    /** Construct a small encoded material fixture without touching production frame code. */
    async function asset(color) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const context = canvas.getContext("2d");
      context.fillStyle = color;
      context.fillRect(0, 0, 32, 32);
      const blob = await new Promise((resolve) => {
        /* Encode cold image bytes for the real uploader. */ canvas.toBlob(
          resolve,
          "image/png",
        );
      });
      return {
        meshes: [],
        nodes: [],
        skins: [],
        animations: [],
        cameras: [],
        scenes: [],
        defaultScene: 0,
        textures: [
          {
            name: color,
            mimeType: "image/png",
            image: new Uint8Array(await blob.arrayBuffer()),
          },
        ],
        materials: [
          {
            textures: {
              baseColor: {
                texture: 0,
                texCoord: 0,
                magFilter: null,
                minFilter: null,
                wrapS: 10497,
                wrapT: 10497,
              },
            },
            emissive: new Float32Array(3),
            normalScale: 1,
            occlusionStrength: 1,
          },
        ],
      };
    }
    const red = await asset("red"),
      green = await asset("green"),
      base = app.memory;
    const bytes = 5460; // 32²+16²+8²+4²+2²+1² RGBA8 texels.
    app.setStreamingBudget({
      maxGPUBytes: base.gpuBytes + bytes,
      maxRecoveryBytes: base.recoveryBytes + 1048576,
      maxConcurrent: 1,
    });
    await app.renderer.streaming.bindMaterial(
      0,
      "red",
      async () => {
        /* Return retained encoded texture provenance. */ return red;
      },
      { estimate: { gpuBytes: bytes, recoveryBytes: 4096 } },
    );
    const resident = app.memory;
    if (
      resident.textureBytes - base.textureBytes !== bytes ||
      resident.mipBytes - base.mipBytes !== 1364 ||
      resident.renderTargetBytes !== base.renderTargetBytes ||
      resident.recoveryBytes <= base.recoveryBytes
    )
      throw new Error("Material mip/recovery accounting failed");
    const other = app.materials.create();
    let started = false,
      denied = false;
    try {
      await app.renderer.streaming.bindMaterial(
        other,
        "green",
        async () => {
          /* A pinned estimate must reject before image loading. */ started = true;
          return green;
        },
        { estimate: { gpuBytes: bytes } },
      );
    } catch (error) {
      denied = error.name === "StreamBudgetError";
    }
    if (!denied || started || app.memory.gpuBytes !== resident.gpuBytes)
      throw new Error("Pinned streaming admission failed");
    app.renderer.streaming.releaseMaterial(0);
    await app.renderer.streaming.bindMaterial(
      other,
      "green",
      async () => {
        /* Pressure should retire red before allocating green. */ return green;
      },
      { estimate: { gpuBytes: bytes } },
    );
    if (
      app.renderer.streaming.resources.records.has("texture:red") ||
      app.memory.gpuBytes !== resident.gpuBytes
    )
      throw new Error("Pressure eviction did not replace resident texture");
    const recoveryReference = app.memory;
    await app.recoverDevice();
    app.stop();
    watch();
    const recovered = app.memory;
    if (
      JSON.stringify(recovered) !== JSON.stringify(recoveryReference) ||
      app.renderer.streaming.resources.diagnostics.budget.maxGPUBytes !==
        base.gpuBytes + bytes
    )
      throw new Error("Memory accounting or budget changed during recovery");
    app.setStreamingBudget({ maxGPUBytes: base.gpuBytes });
    if ((await app.renderer.streaming.trimBudget()) !== 0)
      throw new Error("Pressure evicted a bound texture");
    app.renderer.streaming.releaseMaterial(other);
    if (
      (await app.renderer.streaming.trimBudget()) !== 1 ||
      app.memory.gpuBytes !== base.gpuBytes
    )
      throw new Error("Released residency failed to fit lowered budget");
    let actualRejected = false;
    try {
      await app.renderer.streaming.bindMaterial(other, "oversize", async () => {
        /* A zero estimate exercises measured-size rollback. */ return red;
      });
    } catch (error) {
      actualRejected = error.name === "StreamBudgetError";
    }
    if (!actualRejected || app.memory.gpuBytes !== base.gpuBytes)
      throw new Error("Underestimated upload was published or leaked");
    const beforeHDR = app.memory;
    app.renderer.hdr.enabled = true;
    const hdr = app.memory;
    if (hdr.renderTargetBytes <= beforeHDR.renderTargetBytes)
      throw new Error("HDR target storage was not tracked");
    app.gpu.renderScale = 0.5;
    app.renderer.resize(); // Apply the stopped application's pending target resize explicitly.
    const resized = app.memory;
    if (resized.renderTargetBytes >= hdr.renderTargetBytes)
      throw new Error("Resize did not reduce target storage");
    let compressedBytes = 0;
    if (app.gpu.device.features.has("texture-compression-bc")) {
      const stats = app.renderer.resources.stats,
        before = stats.compressedTextureBytes;
      const texture = app.renderer.resources.textures.create(
        {
          size: [4, 4],
          format: "bc1-rgba-unorm",
          mipLevelCount: 3,
          usage: GPUTextureUsage.TEXTURE_BINDING,
        },
        "asset",
      );
      compressedBytes = stats.compressedTextureBytes - before;
      if (compressedBytes !== 24)
        throw new Error(
          "Compressed small mips did not round to complete blocks",
        );
      app.renderer.resources.textures.destroy(texture);
    }
    const resources = app.renderer.resources;
    await app.dispose();
    return {
      base,
      resident,
      recovered,
      hdr,
      resized,
      compressedBytes,
      actualRejected,
      gpuErrors,
      finalGPUBytes: resources.stats.gpuBytes,
      finalTextureBytes: resources.stats.textureBytes,
      finalRenderTargetBytes: resources.stats.renderTargetBytes,
    };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(report.gpuErrors, []);
  assert.equal(report.finalGPUBytes, 0);
  assert.equal(report.finalTextureBytes, 0);
  assert.equal(report.finalRenderTargetBytes, 0);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/memory-streaming.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
