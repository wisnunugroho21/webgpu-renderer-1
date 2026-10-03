import { RenderFlags } from "./RenderFlags";
import { MeshManager } from "./MeshManager";
import { RenderQueue } from "./RenderQueue";
import { RenderWorld } from "./RenderWorld";
export class InstanceManager {
  readonly data: Uint32Array;
  constructor(capacity: number) {
    this.data = new Uint32Array(capacity * 12);
  }
  update(queue: RenderQueue, world: RenderWorld, meshes?: MeshManager): void {
    for (let i = 0; i < queue.count; i++) {
      const object = queue.order[i]!,
        offset = i * 12;
      this.data[offset] = world.transformIndex[object]!;
      this.data[offset + 1] = world.materialId[object]!;
      this.data[offset + 2] = world.jointOffset[object]!;
      this.data[offset + 3] = world.jointCounts[object]!;
      // Morph GPU ranges are populated in their later runtime phases.
      this.data[offset + 4] = world.morphOffset[object]!;
      this.data[offset + 5] = world.morphCounts[object]!;
      this.data[offset + 6] = world.entityId[object]!;
      this.data[offset + 7] =
        world.flags[object]! |
        (world.morphDense[object] ? RenderFlags.MORPH_DENSE : 0);
      const mesh = meshes?.get(world.meshId[object]!);
      if (
        world.morphCounts[object] &&
        meshes &&
        (!mesh?.morph ||
          mesh.morphOffset === undefined ||
          mesh.morph.targetCount !== world.morphCounts[object])
      )
        throw new Error("Morph GPU data mismatch");
      this.data[offset + 8] = mesh?.morphOffset ?? 0;
      this.data[offset + 9] = mesh?.morph?.vertexCount ?? 0;
      this.data[offset + 10] = world.meshId[object]!;
      this.data[offset + 11] = 0;
    }
  }
}
