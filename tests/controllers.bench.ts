import { bench } from "vitest";
import { Camera } from "../src/rendering/Camera";
import { OrbitCameraController } from "../src/camera/OrbitCameraController";
import { ThirdPersonCameraController } from "../src/camera/ThirdPersonCameraController";
import { GamepadInput } from "../src/input/GamepadInput";
const orbit = new OrbitCameraController(new Camera()),
  follow = new ThirdPersonCameraController(new Camera()),
  target = new Float32Array([1, 2, 3]);
const pads = [
  {
    index: 0,
    id: "benchmark",
    connected: true,
    mapping: "standard",
    axes: [0.5, 0.2, -0.4, 0.6],
    buttons: Array.from(
      { length: 16 },
      () => /** Builds a record containing pressed, value. */ ({
        pressed: false,
        value: 0,
      }),
    ),
  },
] as unknown as Gamepad[];
const input = new GamepadInput(undefined, () => /** Returns pads. */ pads);
bench("1000 orbit updates", () => {
  // Measures 1000 orbit updates.

  for (let i = 0; i < 1000; i++) orbit.update(1, 0.5, 0);
});
bench("1000 follow updates", () => {
  // Measures 1000 follow updates.

  for (let i = 0; i < 1000; i++) follow.follow(1 / 60, target, 0, 1);
});
bench("1000 standard gamepad polls (provider cost excluded)", () => {
  // Measures 1000 standard gamepad polls (provider cost excluded).

  for (let i = 0; i < 1000; i++) input.update();
});
