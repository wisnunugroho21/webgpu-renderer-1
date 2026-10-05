import type { Application } from "../app/Application";
import { KeyboardInput } from "../input/KeyboardInput";
/** Demonstrate a continuous plume and event bursts; effects share bounded records and two blend groups. */
export function createParticleExample(app: Application): {
  /** Release controls and emission before application disposal. */ dispose(): void;
} {
  app.particles.enabled = true;
  app.renderer.hdr.enabled = true;
  app.renderer.hdr.toneMapping = "filmic";
  app.renderer.hdr.bloomStrength = 0.25;
  app.renderer.camera.setPosition(0, 2, 7);
  app.renderer.camera.setTarget(0, 1, 0);
  app.world.transforms.setScale(app.sceneEntity, 0.6, 0.15, 0.6);
  // Build four straight-alpha sprite frames once; production art can supply decoded RGBA8 pixels.
  const tile = 32,
    frames = 4,
    pixels = new Uint8Array(tile * tile * frames * 4);
  for (let frame = 0; frame < frames; frame++)
    for (let y = 0; y < tile; y++)
      for (let x = 0; x < tile; x++) {
        const dx = ((x + 0.5) / tile) * 2 - 1,
          dy = ((y + 0.5) / tile) * 2 - 1;
        const radius = Math.hypot(dx * (1 + frame * 0.12), dy);
        const offset = (y * tile * frames + frame * tile + x) * 4;
        pixels[offset] = 255;
        pixels[offset + 1] = 180 - frame * 25;
        pixels[offset + 2] = 80;
        pixels[offset + 3] = Math.round(Math.max(0, 1 - radius) ** 2 * 255);
      }
  app.particles.setAtlas({
    width: tile * frames,
    height: tile,
    columns: frames,
    rows: 1,
    pixels,
  });
  const flameCurve = app.particles.createCurve([
    { time: 0, size: 0.5, color: [1, 1, 1, 0] },
    { time: 0.2, size: 1, color: [1, 1, 1, 1] },
    { time: 0.7, size: 1.3, color: [1, 0.5, 0.3, 0.6] },
    { time: 1, size: 1.5, color: [1, 0.2, 0.1, 0] },
  ]);
  const trail = app.particles.createTrail({
    width: 0.08,
    lifetime: 0.8,
    color: [0.2, 1, 4, 1],
    blend: "additive",
    softDistance: 0.2,
  });
  const plume = app.particles.createEmitter({
    position: [0, 0.4, 0],
    rate: 35,
    velocity: [0, 0, 0],
    velocitySpread: [0, 0, 0],
    emission: {
      shape: "cone",
      direction: [0, 1, 0],
      angle: 0.2,
      radius: 0.15,
      speed: [0.8, 1.4],
    },
    sprite: { frameCount: frames, fps: 6, loop: true },
    curve: flameCurve,
    softDistance: 0.3,
    lifetime: [1.5, 2.5],
    startColor: [4, 2, 1, 0.9],
    endColor: [0.02, 0.1, 0.3, 0],
    startSize: 0.12,
    endSize: 0.6,
    blend: "additive",
    shape: "glow",
  });
  app.canvas.tabIndex = 0;
  const input = new KeyboardInput(app.canvas, [
    "Space",
    "KeyP",
    "KeyB",
    "KeyC",
  ]);
  /** Focus the demonstration so key actions remain scoped to its canvas. */
  function focus(): void {
    app.canvas.focus();
  }
  app.canvas.addEventListener("pointerdown", focus);
  const off = app.onUpdate(() => {
    // Settings are explicit user actions; steady frames only advance time and spawn bounded particles.
    if (input.consumePressed("Space")) {
      app.particles.playEffect("explosion", [0, 1.5, 0]);
      app.particles.playEffect("shockwave", [0, 1.5, 0]);
    }
    if (input.consumePressed("KeyP"))
      app.particles.enabled = !app.particles.enabled;
    if (input.consumePressed("KeyB"))
      app.renderer.hdr.bloomStrength = app.renderer.hdr.bloomStrength
        ? 0
        : 0.25;
    if (input.consumePressed("KeyC"))
      app.particles.playEffect("confetti", [0, 1, 0]);
    const t = app.particles.time;
    trail.addPoint(
      Math.cos(t * 2) * 1.5,
      1.2 + Math.sin(t * 3) * 0.4,
      Math.sin(t * 2) * 0.7,
    );
    app.status.textContent = `Particles: ${app.particles.count} · Ribbon: ${app.particles.trails.count} · Space: explosion · C: confetti · P: pause · B: bloom`;
  });
  return {
    /** Stop the reusable controller and remove canvas listeners; Resources owns GPU destruction. */ dispose(): void {
      off();
      plume.dispose();
      trail.dispose();
      input.dispose();
      app.canvas.removeEventListener("pointerdown", focus);
      app.particles.clear();
      app.particles.enabled = false;
    },
  };
}
