import { Application } from "../app/Application";
import { KeyboardInput } from "../input/KeyboardInput";
import { PointerInput } from "../input/PointerInput";
import { TouchJoystick } from "../input/TouchJoystick";
import { GamepadInput } from "../input/GamepadInput";
import { OrbitCameraController } from "../camera/OrbitCameraController";
import { ThirdPersonCameraController } from "../camera/ThirdPersonCameraController";
import { CollectGame } from "./CollectGame";
/** A complete small example using shared cube geometry and material data, with no custom render pass. */
export function createCollectExample(app: Application): {
  game: CollectGame;
  dispose: () => void;
} {
  const w = app.world,
    game = new CollectGame();
  const playerMaterial = app.materials.create({
    baseColor: [0.08, 0.8, 0.95, 1],
    roughness: 0.45,
  });
  const floorMaterial = app.materials.create({
    baseColor: [0.06, 0.12, 0.2, 1],
    roughness: 1,
  });
  const itemMaterial = app.materials.create({
    baseColor: [1, 0.65, 0.05, 1],
    emissive: [0.15, 0.06, 0],
    roughness: 0.35,
  });
  w.meshes.set(app.sceneEntity, 0, playerMaterial);
  w.transforms.setScale(app.sceneEntity, 0.35, 0.35, 0.35);
  const cube = (
    material: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): number => {
    const e = w.create();
    w.transforms.add(e);
    w.transforms.setPosition(e, x, y, z);
    w.transforms.setScale(e, sx, sy, sz);
    w.meshes.set(e, 0, material);
    w.bounds.setSphere(e, 0, 0, 0, Math.sqrt(3));
    return e;
  };
  const floor = cube(floorMaterial, 0, -0.2, 0, 9, 0.1, 6);
  const items = new Uint32Array(game.itemX.length);
  for (let i = 0; i < items.length; i++)
    items[i] = cube(
      itemMaterial,
      game.itemX[i]!,
      0.5,
      game.itemZ[i]!,
      0.25,
      0.25,
      0.25,
    );
  const camera = app.renderer.camera;
  camera.setPosition(0, 14, 10);
  camera.setTarget(0, 0, 0);
  camera.setOrthographic({ height: 18, near: 0.1, far: 60 });
  app.canvas.tabIndex = 0;
  app.canvas.setAttribute(
    "aria-label",
    "Collect six golden cubes. Use WASD, arrows, touch stick or gamepad to move. R restarts, C switches projection, F follows. Drag to orbit and wheel to zoom.",
  );
  const input = new KeyboardInput(app.canvas, [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "KeyR",
    "KeyC",
    "KeyF",
  ]);
  const pointer = new PointerInput(app.canvas),
    gamepad = new GamepadInput(app.canvas),
    orbit = new OrbitCameraController(camera),
    follow = new ThirdPersonCameraController(camera, { height: 0.5 }),
    deltas = new Float32Array(3),
    playerPosition = new Float32Array(3);
  const touchTarget = app.canvas.ownerDocument.createElement("div");
  touchTarget.className = "touch-stick";
  touchTarget.textContent = "Drag to move";
  touchTarget.setAttribute("aria-label", "Touch movement joystick");
  app.canvas.ownerDocument.body.append(touchTarget);
  const touch = new TouchJoystick(touchTarget);
  let following = false;
  app.canvas.addEventListener("pointerdown", focus);
  function focus(): void {
    app.canvas.focus();
  }
  let shownScore = -1,
    elapsed = 0;
  const updateStatus = () => {
    if (shownScore === game.score) return;
    shownScore = game.score;
    app.status.textContent = `Collected ${game.score}/${items.length}\nWASD / stick: move · R / A: restart · C / Y: camera
F / X: follow · Drag: orbit · Wheel: zoom\n${game.score === items.length ? "All collected! Press R to play again." : "Click the scene to focus the controls."}`;
  };
  const reset = () => {
    game.reset();
    for (const e of items) w.meshes.set(e, 0, itemMaterial);
    shownScore = -1;
    updateStatus();
  };
  const offFixed = app.onFixedUpdate((dt) => {
    gamepad.update();
    if (input.consumePressed("KeyR") || gamepad.consumePressed(0)) reset();
    if (input.consumePressed("KeyF") || gamepad.consumePressed(2)) {
      following = !following;
      if (following) follow.syncFromCamera();
      else orbit.syncFromCamera();
    }
    if (input.consumePressed("KeyC") || gamepad.consumePressed(3)) {
      if (camera.projectionType === "orthographic")
        camera.setPerspective({ fovY: Math.PI / 3, near: 0.1, far: 60 });
      else camera.setOrthographic({ height: 18, near: 0.1, far: 60 });
    }
    const horizontal =
      Number(input.isDown("KeyD") || input.isDown("ArrowRight")) -
      Number(input.isDown("KeyA") || input.isDown("ArrowLeft")) +
      touch.axes[0]! +
      gamepad.axes[0]!;
    const vertical =
      Number(input.isDown("KeyS") || input.isDown("ArrowDown")) -
      Number(input.isDown("KeyW") || input.isDown("ArrowUp")) +
      touch.axes[1]! +
      gamepad.axes[1]!;
    game.step(dt, horizontal, vertical);
    for (let i = 0; i < items.length; i++)
      if (game.collected[i]) w.meshes.remove(items[i]!);
    updateStatus();
  });
  const offUpdate = app.onUpdate((dt, alpha) => {
    elapsed += dt;
    // Interpolate the visual pose between completed fixed ticks; collision uses simulation state.
    w.transforms.setPosition(
      app.sceneEntity,
      game.previousX + (game.x - game.previousX) * alpha,
      0.45,
      game.previousZ + (game.z - game.previousZ) * alpha,
    );
    pointer.consume(deltas);
    if (following) {
      playerPosition[0] = game.previousX + (game.x - game.previousX) * alpha;
      playerPosition[1] = 0;
      playerPosition[2] = game.previousZ + (game.z - game.previousZ) * alpha;
      follow.follow(dt, playerPosition, 0, deltas[0]!, deltas[1]!, deltas[2]!);
    } else if (deltas[0] || deltas[1] || deltas[2])
      orbit.update(deltas[0]!, deltas[1]!, deltas[2]!);
    const angle = elapsed * 0.7;
    for (let i = 0; i < items.length; i++)
      if (!game.collected[i]) {
        w.transforms.setPosition(
          items[i]!,
          game.itemX[i]!,
          0.55 + Math.sin(elapsed * 2 + i) * 0.12,
          game.itemZ[i]!,
        );
        w.transforms.setRotation(
          items[i]!,
          0,
          Math.sin(angle),
          0,
          Math.cos(angle),
        );
      }
  });
  updateStatus();
  app.canvas.focus();
  return {
    game,
    dispose: () => {
      offFixed();
      offUpdate();
      input.dispose();
      pointer.dispose();
      touch.dispose();
      touchTarget.remove();
      gamepad.dispose();
      app.canvas.removeEventListener("pointerdown", focus);
      for (const e of items) w.destroy(e);
      w.destroy(floor);
    },
  };
}
