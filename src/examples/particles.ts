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
  const plume = app.particles.createEmitter({
    position: [0, 0.4, 0],
    rate: 35,
    velocity: [0, 1.1, 0],
    velocitySpread: [0.3, 0.3, 0.3],
    lifetime: [1.5, 2.5],
    startColor: [0.1, 0.6, 2, 0.7],
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
    app.status.textContent = `Particles: ${app.particles.count} · Space: explosion · C: confetti · P: pause · B: bloom`;
  });
  return {
    /** Stop the reusable controller and remove canvas listeners; Resources owns GPU destruction. */ dispose(): void {
      off();
      plume.dispose();
      input.dispose();
      app.canvas.removeEventListener("pointerdown", focus);
      app.particles.clear();
      app.particles.enabled = false;
    },
  };
}
