import type { World } from "../ecs/World";
import type { MaterialManager } from "../rendering/materials/MaterialManager";

/** Build the demonstration cube and sun before startup; shared mesh/material slot zero is intentional.
 * Keep entity/material allocation order stable for examples and diagnostic fixtures. */
export function createDefaultScene(
  world: World,
  materials: MaterialManager,
): { sceneEntity: number; defaultLightEntity: number } {
  const sceneEntity = world.create();
  world.transforms.add(sceneEntity);
  world.meshes.set(sceneEntity, 0, 0);
  world.bounds.setSphere(sceneEntity, 0, 0, 0, Math.sqrt(3));
  materials.create();
  const defaultLightEntity = world.create();
  world.transforms.add(defaultLightEntity);
  world.lights.set(defaultLightEntity, {
    type: "directional",
    intensity: 3,
    direction: [-0.4, -0.6, -1],
  });
  return { sceneEntity, defaultLightEntity };
}
