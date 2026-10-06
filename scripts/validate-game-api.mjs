import { launchValidationBrowser } from "./gpu/validation-browser.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startPreviewServer } from "./gpu/preview-server.mjs";
await mkdir("artifacts", { recursive: true });
const server = await startPreviewServer(5192, true);
let browser;
try {
  browser = await launchValidationBrowser();
  const page = await browser.newPage({
    viewport: { width: 640, height: 480 },
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (error) =>
    /** Delegates this operation to errors.push. */ errors.push(error.message),
  );
  await page.goto("http://127.0.0.1:5192");
  await page.waitForFunction(
    () =>
      /** Evaluates the window.rendererApp?.frames >= 10 condition. */ window
        .rendererApp?.frames >= 10,
  );
  const report = await page.evaluate(async () => {
    // Builds a record containing projection checks, orthographic shadow passes, clipped shadow passes, cpu level, indirect difference, fixed.

    const app = window.rendererApp,
      r = app.renderer,
      w = app.world;
    app.pause();
    /** Prepares the current scene, submits GPU work and reads pixels only for this diagnostic scenario. */
    const draw = async () => {
      app.transformSystem.update(w.transforms);
      app.extractor.extract(
        w,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
      const texture = app.gpu.context.getCurrentTexture(),
        encoder = app.gpu.device.createCommandEncoder();
      r.encode(encoder, texture.createView({ format: app.gpu.renderFormat }));
      const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
      const buffer = app.gpu.device.createBuffer({
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
    r.camera.setPosition(0, 0, 12);
    r.camera.setTarget(0, 0, 0);
    for (let i = 0; i < 32; i++) {
      const e = w.create();
      w.transforms.add(e);
      w.transforms.setPosition(
        e,
        ((i % 8) - 3.5) * 0.8,
        (Math.floor(i / 8) - 1.5) * 0.8,
        2,
      );
      w.lights.set(e, { type: "point", range: 3, intensity: 0.2 });
    }
    const projectionChecks = [];
    for (const kind of ["perspective", "orthographic"]) {
      if (kind === "perspective")
        r.camera.setPerspective({ fovY: Math.PI / 2, near: 2, far: 200 });
      else r.camera.setOrthographic({ height: 8, near: 0, far: 40 });
      r.clusters.mode = "off";
      const full = await draw();
      r.clusters.mode = "on";
      const clustered = await draw();
      projectionChecks.push({
        kind,
        differentBytes: difference(full, clustered),
        near: r.frameUniforms?.data?.[40] ?? r.camera.near,
        far: r.camera.far,
      });
    }
    r.shadows.enabled = true;
    r.shadows.cascades = 4;
    w.lights.castShadow[app.defaultLightEntity] = 1;
    await draw();
    const orthographicShadowPasses = r.stats.shadowPasses;
    r.camera.setOrthographic({ near: 35, far: 40 });
    await draw();
    const clippedShadowPasses = r.stats.shadowPasses;
    r.shadows.enabled = false;
    r.camera.setOrthographic({ height: 8, near: 0, far: 40 });
    const group = r.lodGroups.register([0, 0], [100, 1], r.meshes, 0);
    w.meshes.setLOD(app.sceneEntity, group);
    r.submissionMode = "instanced";
    const cpu = await draw(),
      cpuLevel = app.renderWorld.lodSelection[0];
    let indirectDifference = null;
    if (r.gpuDraws.supported) {
      r.submissionMode = "gpu-indirect";
      const gpu = await draw();
      indirectDifference = difference(cpu, gpu);
    }
    r.submissionMode = "instanced";
    w.meshes.setLOD(app.sceneEntity, -1);
    const cameraEntity = w.create();
    w.transforms.add(cameraEntity);
    w.transforms.setPosition(cameraEntity, 0, 0, 12);
    w.cameras.setOrthographic(cameraEntity, { height: 8 });
    app.setActiveCamera(cameraEntity);
    let fixed = 0,
      variable = 0;
    const offFixed = app.onFixedUpdate(() => {
        // Increments the update-hook counter to verify simulation dispatch.

        fixed++;
      }),
      offUpdate = app.onUpdate(() => {
        // Increments the update-hook counter to verify simulation dispatch.

        variable++;
      });
    app.resume();
    await new Promise((resolve) =>
      /** Delegates this operation to setTimeout. */ setTimeout(resolve, 120),
    );
    app.pause();
    const pausedFrames = app.frames;
    await new Promise((resolve) =>
      /** Delegates this operation to setTimeout. */ setTimeout(resolve, 80),
    );
    const stillPaused = app.frames === pausedFrames;
    offFixed();
    offUpdate();
    const before = { ...r.resources.stats };
    app.resume();
    app.resume();
    await new Promise((resolve) =>
      /** Delegates this operation to setTimeout. */ setTimeout(resolve, 80),
    );
    app.pause();
    const after = { ...r.resources.stats };
    return {
      projectionChecks,
      orthographicShadowPasses,
      clippedShadowPasses,
      cpuLevel,
      indirectDifference,
      fixed,
      variable,
      stillPaused,
      resumed: app.frames > pausedFrames,
      cameraEntity: app.cameraSystem.activeEntity,
      cameraPosition: Array.from(r.camera.position),
      before,
      after,
      errors: app.gpu.errors,
    };
  });
  for (const check of report.projectionChecks)
    assert.equal(check.differentBytes, 0);
  assert.ok(report.orthographicShadowPasses > 0);
  assert.equal(report.clippedShadowPasses, 0);
  assert.equal(report.cpuLevel, 0);
  if (report.indirectDifference !== null)
    assert.equal(report.indirectDifference, 0);
  assert.ok(report.fixed > 0 && report.variable > 0);
  assert.ok(report.stillPaused && report.resumed);
  assert.deepEqual(report.cameraPosition, [0, 0, 12]);
  assert.deepEqual(report.before, report.after);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(errors, []);
  await page.evaluate(async () => {
    // Applies window.rendererApp.dispose to the current callback state.

    await window.rendererApp.dispose();
  });
  await page.goto("http://127.0.0.1:5192/?example=collect");
  await page.waitForFunction(
    () =>
      /** Evaluates the window.collectGame && window.rendererApp.frames >= 10 condition. */ window.collectGame &&
      window.rendererApp.frames >= 10,
  );
  await page.evaluate(() =>
    /** Delegates this operation to window.rendererApp.pause. */ window.rendererApp.pause(),
  );
  const exampleBefore = await page.evaluate(
    () => /** Returns an empty fixture handle for a controlled test dependency. */ ({
      ...window.rendererApp.renderer.resources.stats,
    }),
  );
  await page.keyboard.down("a");
  await page.evaluate(() => {
    // Applies window.rendererApp.simulation.advance to the current callback state.

    for (let i = 0; i < 60; i++) window.rendererApp.simulation.advance(1 / 60);
  });
  await page.keyboard.up("a");
  const moved = await page.evaluate(
    () => /** Builds a record containing x, score, status. */ ({
      x: window.collectGame.x,
      score: window.collectGame.score,
      status: window.rendererApp.status.textContent,
    }),
  );
  assert.ok(moved.x < -4.9);
  assert.equal(moved.score, 1);
  assert.match(moved.status, /Collected 1\/6/);
  await page.keyboard.press("c");
  const switched = await page.evaluate(() => {
    // Returns window renderer app renderer camera projection type.

    window.rendererApp.simulation.advance(1 / 60);
    return window.rendererApp.renderer.camera.projectionType;
  });
  assert.equal(switched, "perspective");
  await page.keyboard.down("d");
  await page.evaluate(() =>
    /** Delegates this operation to window.rendererApp.canvas.blur. */ window.rendererApp.canvas.blur(),
  );
  const blurPosition = await page.evaluate(() => {
    // Returns window collect game x.

    for (let i = 0; i < 30; i++) window.rendererApp.simulation.advance(1 / 60);
    return window.collectGame.x;
  });
  assert.equal(blurPosition, moved.x);
  await page.keyboard.up("d");
  await page.evaluate(() =>
    /** Delegates this operation to window.rendererApp.canvas.focus. */ window.rendererApp.canvas.focus(),
  );
  await page.keyboard.press("r");
  const restarted = await page.evaluate(() => {
    // Builds a record containing x, score.

    window.rendererApp.simulation.advance(1 / 60);
    return { x: window.collectGame.x, score: window.collectGame.score };
  });
  assert.deepEqual(restarted, { x: 0, score: 0 });
  const exampleFrames = await page.evaluate(
    () => /** Returns window renderer app frames. */ window.rendererApp.frames,
  );
  await page.evaluate(() =>
    /** Delegates this operation to window.rendererApp.resume. */ window.rendererApp.resume(),
  );
  await page.waitForFunction(
    (target) =>
      /** Evaluates the window.rendererApp.frames >= target condition. */ window
        .rendererApp.frames >= target,
    exampleFrames + 4,
  );
  await page.evaluate(() =>
    /** Delegates this operation to window.rendererApp.pause. */ window.rendererApp.pause(),
  );
  const exampleAfter = await page.evaluate(
    () => /** Returns an empty fixture handle for a controlled test dependency. */ ({
      ...window.rendererApp.renderer.resources.stats,
    }),
  );
  assert.deepEqual(exampleAfter, exampleBefore);
  // Actual captured mouse and touch streams exercise the reusable helpers through the game.
  const cameraBefore = await page.evaluate(() =>
    /** Delegates this operation to Array.from. */ Array.from(
      window.rendererApp.renderer.camera.position,
    ),
  );
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(550, 320, { steps: 3 });
  await page.mouse.up();
  const cameraDragged = await page.evaluate(() => {
    // Delegates this operation to Array.from.

    window.rendererApp.simulation.advance(1 / 60);
    return Array.from(window.rendererApp.renderer.camera.position);
  });
  assert.notDeepEqual(cameraDragged, cameraBefore);
  await page.mouse.wheel(0, 120);
  const cameraZoomed = await page.evaluate(() => {
    // Delegates this operation to Array.from.

    window.rendererApp.simulation.advance(1 / 60);
    return Array.from(window.rendererApp.renderer.camera.position);
  });
  assert.notDeepEqual(cameraZoomed, cameraDragged);
  await page.keyboard.press("r");
  await page.evaluate(() =>
    /** Delegates this operation to window.rendererApp.simulation.advance. */ window.rendererApp.simulation.advance(
      1 / 60,
    ),
  );
  const touchRect = await page.locator(".touch-stick").boundingBox();
  assert.ok(touchRect);
  const touchSession = await page.context().newCDPSession(page);
  const x = touchRect.x + touchRect.width / 2,
    y = touchRect.y + touchRect.height / 2;
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 48, y, id: 1 }],
  });
  const touchMoved = await page.evaluate(() => {
    // Returns window collect game x.

    for (let i = 0; i < 30; i++) window.rendererApp.simulation.advance(1 / 60);
    return window.collectGame.x;
  });
  assert.ok(touchMoved > 2.4);
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const touchStopped = await page.evaluate(() => {
    // Returns window collect game x.

    for (let i = 0; i < 30; i++) window.rendererApp.simulation.advance(1 / 60);
    return window.collectGame.x;
  });
  assert.equal(touchStopped, touchMoved);
  await touchSession.detach();
  // Browsers expose hardware pads through polling; inject only that boundary for deterministic coverage.
  const pads = await page.evaluate(() => {
    // Builds a record containing moved, stopped, restarted, unfocused.

    const app = window.rendererApp;
    app.canvas.focus();
    const pad = {
      index: 0,
      id: "diagnostic",
      connected: true,
      mapping: "standard",
      axes: [-1, 0, 0, 0],
      buttons: [{ pressed: false, value: 0 }],
    };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      /** Selects the result according to pad.connected. */
      value: () => (pad.connected ? [pad] : []),
    });
    for (let i = 0; i < 30; i++) app.simulation.advance(1 / 60);
    const moved = window.collectGame.x;
    pad.connected = false;
    for (let i = 0; i < 30; i++) app.simulation.advance(1 / 60);
    const stopped = window.collectGame.x;
    pad.connected = true;
    pad.axes[0] = 0;
    pad.buttons[0] = { pressed: true, value: 1 };
    app.simulation.advance(1 / 60);
    const restarted = window.collectGame.x;
    pad.buttons[0] = { pressed: false, value: 0 };
    pad.axes[0] = 1;
    app.canvas.blur();
    for (let i = 0; i < 30; i++) app.simulation.advance(1 / 60);
    const unfocused = window.collectGame.x;
    delete navigator.getGamepads;
    app.canvas.focus();
    return { moved, stopped, restarted, unfocused };
  });
  assert.ok(pads.moved < touchStopped - 2.4);
  assert.equal(pads.stopped, pads.moved);
  assert.equal(pads.restarted, 0);
  assert.equal(pads.unfocused, 0);
  await page.keyboard.press("f");
  const followed = await page.evaluate(() => {
    // Delegates this operation to Array.from.

    for (let i = 0; i < 90; i++) window.rendererApp.simulation.advance(1 / 60);
    return Array.from(window.rendererApp.renderer.camera.target);
  });
  assert.ok(Math.abs(followed[1] - 0.5) < 0.001);
  const controllerFrames = await page.evaluate(
    () => /** Returns window renderer app frames. */ window.rendererApp.frames,
  );
  await page.evaluate(() =>
    /** Delegates this operation to window.rendererApp.resume. */ window.rendererApp.resume(),
  );
  await page.waitForFunction(
    (target) =>
      /** Evaluates the window.rendererApp.frames >= target condition. */ window
        .rendererApp.frames >= target,
    controllerFrames + 6,
  );
  await page.evaluate(() =>
    /** Delegates this operation to window.rendererApp.pause. */ window.rendererApp.pause(),
  );
  assert.deepEqual(
    await page.evaluate(
      () => /** Returns an empty fixture handle for a controlled test dependency. */ ({
        ...window.rendererApp.renderer.resources.stats,
      }),
    ),
    exampleBefore,
  );
  report.controllers = {
    cameraBefore,
    cameraDragged,
    cameraZoomed,
    touchMoved,
    touchStopped,
    pads,
    followed,
  };
  await page.screenshot({ path: "artifacts/collect-game.png" });
  const exampleErrors = await page.evaluate(
    () =>
      /** Returns window renderer app gpu errors. */ window.rendererApp.gpu
        .errors,
  );
  assert.deepEqual(exampleErrors, []);
  assert.deepEqual(errors, []);
  report.example = {
    moved,
    switched,
    blurPosition,
    restarted,
    exampleBefore,
    exampleAfter,
    errors: exampleErrors,
  };
  await page.evaluate(async () => {
    // Applies window.rendererApp.dispose to the current callback state.

    await window.rendererApp.dispose();
  });
  report.environment = {
    mode: "production-preview",
    browser: await browser.version(),
    timestamp: new Date().toISOString(),
  };
  await writeFile(
    "artifacts/game-api-gpu.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        projectionChecks: report.projectionChecks,
        orthographicShadowPasses: report.orthographicShadowPasses,
        indirectDifference: report.indirectDifference,
        fixed: report.fixed,
        variable: report.variable,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await browser?.close();
  } finally {
    server.kill("SIGTERM");
  }
}
