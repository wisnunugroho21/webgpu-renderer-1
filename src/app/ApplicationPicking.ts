import { World } from "../ecs/World";
import { EntityHandle } from "../ecs/Entity";
import { Camera } from "../rendering/Camera";
import { Ray } from "../spatial/Ray";
import { RayHit, SpatialQueries } from "../spatial/SpatialQueries";
/** CSS-space picking owns reusable query scratch; extracted bounds are checked against live identities. */
export class ApplicationPicking {
  private readonly ray = new Ray();
  private readonly hit = new RayHit();
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
    private readonly spatial: SpatialQueries,
  ) {}
  pick(
    camera: Camera | undefined,
    clientX: number,
    clientY: number,
  ): EntityHandle | null {
    if (!camera || !Number.isFinite(clientX) || !Number.isFinite(clientY))
      return null;
    const rect = this.canvas.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      clientX < rect.left ||
      clientY < rect.top ||
      clientX > rect.right ||
      clientY > rect.bottom
    )
      return null;
    this.ray.fromCamera(
      camera,
      (clientX - rect.left) / rect.width,
      (clientY - rect.top) / rect.height,
      this.canvas.width / this.canvas.height,
    );
    if (!this.spatial.raycast(this.ray, this.hit)) return null;
    const hit = this.hit;
    if (
      !this.world.alive[hit.entityId] ||
      this.world.generation[hit.entityId] !== hit.generation
    )
      return null;
    return this.world.handle(hit.entityId);
  }
}
