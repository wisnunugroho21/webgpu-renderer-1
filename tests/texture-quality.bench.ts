import { bench } from "vitest";
import {
  TextureQualityStreaming,
  type TextureQualityHost,
} from "../src/rendering/TextureQualityStreaming";
import { RenderWorld } from "../src/rendering/RenderWorld";
import { RenderQueue } from "../src/rendering/RenderQueue";
import { Camera } from "../src/rendering/Camera";
for (const count of [1000, 10000]) {
  const world = new RenderWorld(count),
    queue = new RenderQueue(count),
    camera = new Camera();
  world.count = queue.count = count;
  camera.setPosition(0, 0, 20);
  camera.setTarget(0, 0, 0);
  camera.update(1);
  const host: TextureQualityHost = {
    qualityGeneration: () => {
      /* Return a stable live mock material identity. */ return 1;
    },
    replaceMaterial: async () => {
      // The measured observer must never perform residency publication.
      throw new Error("Unexpected benchmark publication");
    },
    releaseMaterial: () => {
      // The fallback is already resident in this observation-only workload.
    },
    trimBudget: async () => {
      // There is no budget pressure in this CPU workload.
      return 0;
    },
    qualityMemory: () => {
      // Cold maintenance stays outside the measured observer.
      return {
        memory: { gpuBytes: 0, recoveryBytes: 0 },
        reserved: { gpuBytes: 0, recoveryBytes: 0 },
      };
    },
  };
  const quality = new TextureQualityStreaming(host, 64);
  quality.enabled = true;
  quality.intervalFrames = 1;
  for (let material = 0; material < 64; material++)
    quality.register(material, [
      {
        key: `tier-${material}`,
        minPixels: 10000000,
        estimate: { gpuBytes: 100, recoveryBytes: 100 },
        load: async () => {
          // Loader invocation would indicate the measured observer crossed the cold boundary.
          throw new Error("Unexpected benchmark decode");
        },
      },
    ]);
  for (let object = 0; object < count; object++) {
    queue.order[object] = object;
    world.materialId[object] = object % 64;
    world.sphere.set(
      [(object % 10) - 5, (Math.floor(object / 10) % 10) - 5, -object % 20, 1],
      object * 4,
    );
  }
  let frame = 0;
  bench(`${count} visible objects texture-quality observation`, () => {
    // Measure conservative projected coverage and hysteresis using fixed material scratch.
    quality.update(world, queue, camera, 1080, frame++);
  });
}
