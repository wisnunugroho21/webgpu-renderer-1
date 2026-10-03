import { RenderWorld } from "../RenderWorld";
import { Camera } from "../Camera";
import { LODGroups } from "./LODGroups";
/** Persistent entity-keyed hysteresis; output indices feed normal sorting/batching. */
export class LODSelector {
  readonly visible: Uint32Array;
  readonly distribution = new Uint32Array(8);
  culled = 0;
  private readonly previous: Int8Array;
  private readonly previousGroup: Int32Array;
  constructor(
    capacity: number,
    readonly groups: LODGroups,
  ) {
    this.visible = new Uint32Array(capacity);
    this.previous = new Int8Array(capacity).fill(-2);
    this.previousGroup = new Int32Array(capacity).fill(-1);
  }
  select(
    world: RenderWorld,
    camera: Camera,
    height: number,
    input?: Uint32Array,
    count = world.count,
  ): number {
    if (!Number.isFinite(height) || height <= 0 || count > this.visible.length)
      throw new Error("Invalid LOD selection");
    this.distribution.fill(0);
    this.culled = 0;
    let visible = 0;
    for (let i = 0; i < count; i++) {
      const object = input?.[i] ?? i,
        id = world.entityId[object]!,
        groupId = world.lodGroup[object]!;
      if (groupId < 0) {
        this.visible[visible++] = object;
        this.previousGroup[id] = -1;
        world.lodSelection[object] = -2;
        continue;
      }
      const group = this.groups.entries[groupId];
      if (!group || id >= this.previous.length)
        throw new Error("Unknown LOD group/entity");
      const s = object * 4,
        view = camera.view,
        radius = world.sphere[s + 3]!,
        depth = -(
          view[2]! * world.sphere[s]! +
          view[6]! * world.sphere[s + 1]! +
          view[10]! * world.sphere[s + 2]! +
          view[14]!
        );
      const pixels =
        depth <= radius
          ? Infinity
          : (radius * camera.projection[5]! * height) / (depth - radius);
      let level = -1;
      for (let l = 0; l < group.thresholds.length; l++)
        if (pixels >= group.thresholds[l]!) {
          level = l;
          break;
        }
      const prior =
        this.previousGroup[id] === groupId ? this.previous[id]! : -2;
      if (prior !== -2 && prior !== level) {
        if (prior === -1) {
          if (
            level >= 0 &&
            pixels <
              group.thresholds[group.thresholds.length - 1]! *
                (1 + group.hysteresis)
          )
            level = -1;
        } else if (level === -1) {
          if (pixels > group.thresholds[prior]! * (1 - group.hysteresis))
            level = prior;
        } else if (level < prior) {
          if (pixels < group.thresholds[level]! * (1 + group.hysteresis))
            level = prior;
        } else if (pixels > group.thresholds[prior]! * (1 - group.hysteresis))
          level = prior;
      }
      this.previousGroup[id] = groupId;
      this.previous[id] = level;
      world.lodSelection[object] = level;
      if (level < 0) {
        this.culled++;
        continue;
      }
      world.meshId[object] = group.meshes[level]!;
      this.distribution[level]!++;
      this.visible[visible++] = object;
    }
    return visible;
  }
}
