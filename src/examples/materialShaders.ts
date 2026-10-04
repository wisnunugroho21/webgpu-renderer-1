import { Application } from "../app/Application";
import { KeyboardInput } from "../input/KeyboardInput";

/** Installs a shared procedural RGB shader; alpha, transforms and draw submission remain renderer-owned. */
export async function createMaterialShaderExample(app: Application): Promise<{
  /** Removes example hooks and controls; shared GPU objects remain owned by the application. */
  dispose(): void;
}> {
  const shaderId = await app.registerMaterialShader({
    name: "procedural-bands",
    source: `
// Uses world-space bands and a shared time parameter to shade geometry without vertex uploads.
fn shadeMaterial(surface: MaterialSurface, parameters: MaterialShaderParameters) -> vec3<f32> {
  let phase = surface.worldPosition.y * 6.0 + parameters.values[0].x;
  let stripe = smoothstep(-0.15, 0.15, sin(phase));
  let facing = 0.35 + 0.65 * abs(dot(surface.normal, surface.viewDirection));
  return mix(vec3<f32>(0.04, 0.1, 0.3), vec3<f32>(0.1, 0.85, 1.5), stripe) * facing;
}`,
  });
  const material = app.materials.create({ shaderId, roughness: 0.4 });
  app.world.meshes.set(app.sceneEntity, 0, material);
  app.renderer.camera.setPosition(3, 2, 5);
  app.renderer.camera.setTarget(0, 0, 0);
  app.renderer.hdr.enabled = true;
  app.renderer.hdr.toneMapping = "filmic";
  app.canvas.tabIndex = 0;
  const input = new KeyboardInput(app.canvas, ["KeyM"]);
  const parameters = new Float32Array(4);
  let elapsed = 0,
    custom = true;
  app.status.textContent =
    "Procedural custom shader · Click canvas · M: switch PBR/custom";
  /** Focuses scoped keyboard input when the scene is clicked. */
  function focus(): void {
    app.canvas.focus();
  }
  app.canvas.addEventListener("pointerdown", focus);
  const off = app.onUpdate((dt) => {
    // Reuse one parameter row; changing color animation uploads 64 bytes rather than mesh vertices.
    elapsed += dt;
    if (input.consumePressed("KeyM")) {
      custom = !custom;
      app.materials.setShader(material, custom ? shaderId : 0);
    }
    if (custom) {
      parameters[0] = elapsed;
      app.materials.setShaderParameters(material, parameters);
    }
  });
  return {
    /** Removes example hooks and input; application teardown owns shared GPU resources. */
    dispose(): void {
      off();
      input.dispose();
      app.canvas.removeEventListener("pointerdown", focus);
    },
  };
}
