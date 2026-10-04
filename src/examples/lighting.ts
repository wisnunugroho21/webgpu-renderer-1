import { Application } from "../app/Application";
import { KeyboardInput } from "../input/KeyboardInput";
import { bakeEnvironment } from "../rendering/environment/bakeEnvironment";

/** Cold setup: one shared smooth sphere mesh for the entire material grid. */
function sphere(app: Application): number {
  const segments = 32,
    rings = 16,
    positions = new Float32Array((segments + 1) * (rings + 1) * 3),
    indices: number[] = [];
  for (let y = 0; y <= rings; y++)
    for (let x = 0; x <= segments; x++) {
      const theta = (y * Math.PI) / rings,
        phi = (x * 2 * Math.PI) / segments,
        offset = (y * (segments + 1) + x) * 3;
      positions[offset] = Math.sin(theta) * Math.cos(phi);
      positions[offset + 1] = Math.cos(theta);
      positions[offset + 2] = Math.sin(theta) * Math.sin(phi);
      if (y < rings && x < segments) {
        const a = y * (segments + 1) + x,
          b = a + segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  return app.renderer.meshes.upload({
    attributes: { POSITION: positions, NORMAL: positions },
    indices: new Uint32Array(indices),
    mode: 4,
    material: 0,
    targets: [],
  });
}
/** Installs a shared baked environment and material sphere grid, then registers camera/HDR controls and teardown. */
export async function createLightingExample(app: Application): Promise<{
  /** Releases this owner or scene lifetime according to its independent ownership contract. */
  dispose(): void;
}> {
  const data = bakeEnvironment((direction, out) => {
    // Updates out[0], out[1], out[2] for this callback.

    // Smooth linear HDR sky plus a broad warm light; no external asset dependency.
    const sky = Math.max(0, direction[1]!),
      sun = Math.max(0, direction[0]! * 0.6 + direction[1]! * 0.8) ** 32;
    out[0] = 0.05 + sky * 0.25 + sun * 3;
    out[1] = 0.08 + sky * 0.45 + sun * 2;
    out[2] = 0.12 + sky * 0.9 + sun;
  });
  await app.renderer.setEnvironment(data);
  app.renderer.hdr.enabled = true;
  app.renderer.skybox.enabled = true;
  const w = app.world,
    mesh = sphere(app),
    entities: number[] = [];
  w.destroy(app.sceneEntity);
  w.lights.intensity[app.defaultLightEntity] = 0;
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 6; col++) {
      const material = app.materials.create({
        baseColor: [0.75, 0.42, 0.12, 1],
        metallic: row,
        roughness: 0.05 + col * 0.19,
      });
      const entity = w.create();
      entities.push(entity);
      w.transforms.add(entity);
      w.transforms.setPosition(entity, (col - 2.5) * 2.3, (0.5 - row) * 2.7, 0);
      w.meshes.set(entity, mesh, material);
      w.bounds.setSphere(entity, 0, 0, 0, 1);
    }
  const camera = app.renderer.camera;
  camera.setPosition(0, 0, 18);
  camera.setTarget(0, 0, 0);
  let aspect = -1;
  /** Applies camera.setOrthographic to fit. */
  const fit = () => {
    const next = app.canvas.width / app.canvas.height;
    if (next === aspect) return;
    aspect = next;
    camera.setOrthographic({
      height: Math.max(8, 14 / aspect),
      near: 0.1,
      far: 50,
    });
  };
  fit();
  app.canvas.tabIndex = 0;
  app.canvas.setAttribute(
    "aria-label",
    "Environment lighting: top dielectric, bottom metal; roughness increases left to right. E toggles lighting, H toggles HDR, B toggles skybox, minus/equal adjust exposure, arrows rotate lighting.",
  );
  const input = new KeyboardInput(app.canvas, [
    "KeyE",
    "KeyH",
    "KeyB",
    "Minus",
    "Equal",
    "ArrowLeft",
    "ArrowRight",
  ]);
  /** Delegates this operation to app.canvas.focus. */
  const focus = () => app.canvas.focus();
  app.canvas.addEventListener("pointerdown", focus);
  const hud = document.createElement("output");
  hud.style.cssText =
    "position:fixed;left:16px;top:16px;max-width:calc(100vw - 32px);box-sizing:border-box;color:white;background:#152033dd;padding:12px;font:14px system-ui;pointer-events:none";
  document.body.append(hud);
  /** Applies app.renderer.hdr.exposure.toFixed to describe. */
  const describe = () => {
    hud.textContent = `Top: dielectric · Bottom: metal · Roughness increases → | E: ${app.renderer.environment.enabled ? "IBL on" : "IBL off"} · B: ${app.renderer.skybox.enabled ? "skybox on" : "skybox off"} · H: ${app.renderer.hdr.enabled ? "HDR on" : "HDR off"} · −/+: ${app.renderer.hdr.exposure.toFixed(1)} stops · ←/→ rotate`;
  };
  describe();
  const statusTop = app.status.style.top,
    statusBottom = app.status.style.bottom,
    statusText = app.status.textContent;
  app.status.style.top = "auto";
  app.status.style.bottom = "16px";
  app.status.textContent =
    "Environment lighting and HDR · shared sphere geometry";
  const unsubscribe = app.onUpdate((delta) => {
    // Applies lighting-demo projection, environment, skybox and exposure controls, then refreshes the status text.

    fit();
    if (input.consumePressed("KeyE")) {
      app.renderer.environment.enabled = !app.renderer.environment.enabled;
      describe();
    }
    if (input.consumePressed("KeyH")) {
      app.renderer.hdr.enabled = !app.renderer.hdr.enabled;
      describe();
    }
    if (input.consumePressed("KeyB")) {
      app.renderer.skybox.enabled = !app.renderer.skybox.enabled;
      describe();
    }
    const exposure =
      Number(input.consumePressed("Equal")) -
      Number(input.consumePressed("Minus"));
    if (exposure) {
      app.renderer.hdr.exposure = Math.max(
        -16,
        Math.min(16, app.renderer.hdr.exposure + exposure * 0.5),
      );
      describe();
    }
    const turn =
      Number(input.isDown("ArrowRight")) - Number(input.isDown("ArrowLeft"));
    if (turn) app.renderer.environment.rotationY += turn * delta;
  });
  return {
    /** Applies unsubscribe, input.dispose, app.canvas.removeEventListener to dispose. */
    dispose() {
      unsubscribe();
      app.renderer.hdr.enabled = false;
      app.renderer.skybox.enabled = false;
      input.dispose();
      app.canvas.removeEventListener("pointerdown", focus);
      hud.remove();
      app.status.style.top = statusTop;
      app.status.style.bottom = statusBottom;
      app.status.textContent = statusText;
      for (const entity of entities) w.destroy(entity);
    },
  };
}
