import { Camera } from "../../rendering/Camera";
import { World } from "../World";
/** Application-side camera selection; renderer reads only the camera and extracted scene. */
export class CameraSystem {
  activeEntity: number | null = null;
  private generation = -1;
  private readonly values = new Float64Array(6);
  private readonly previous = new Float64Array(6).fill(NaN);
  select(entity: number | null, world: World): void {
    if (
      entity !== null &&
      (!world.alive[entity] ||
        !world.cameras.has[entity] ||
        !world.transforms.has[entity])
    )
      throw new Error("Unknown camera entity");
    this.activeEntity = entity;
    this.generation = entity === null ? -1 : world.generation[entity]!;
    this.previous.fill(NaN);
  }
  update(world: World, camera: Camera): void {
    const e = this.activeEntity;
    if (e === null) return;
    if (
      !world.alive[e] ||
      world.generation[e] !== this.generation ||
      !world.cameras.has[e] ||
      !world.transforms.has[e]
    ) {
      this.select(null, world);
      return;
    }
    const c = world.cameras;
    const values = this.values;
    values[0] = c.type[e]!;
    values[1] = c.fovY[e]!;
    values[2] = c.near[e]!;
    values[3] = c.far[e]!;
    values[4] = c.height[e]!;
    values[5] = c.aspect[e]!;
    let changed = false;
    for (let i = 0; i < 6; i++)
      if (this.previous[i] !== values[i]) changed = true;
    if (changed) {
      if (c.type[e] === 0)
        camera.setPerspective({
          fovY: c.fovY[e]!,
          near: c.near[e]!,
          far: c.far[e]!,
          aspect: c.aspect[e]! || undefined,
        });
      else
        camera.setOrthographic({
          height: c.height[e]!,
          near: c.near[e]!,
          far: c.far[e]!,
          aspect: c.aspect[e]! || undefined,
        });
      this.previous.set(values);
    }
    const m = world.transforms.worldMatrices,
      o = e * 16;
    camera.setPosition(m[o + 12]!, m[o + 13]!, m[o + 14]!);
    camera.setTarget(
      m[o + 12]! - m[o + 8]!,
      m[o + 13]! - m[o + 9]!,
      m[o + 14]! - m[o + 10]!,
    );
    camera.setUp(m[o + 4]!, m[o + 5]!, m[o + 6]!);
  }
}
