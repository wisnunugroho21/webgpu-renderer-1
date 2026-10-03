import { INSTANCE_WORDS, InstanceWord } from "./layouts";
import { RenderFlags } from "./RenderFlags";
import { MeshManager } from "./MeshManager";
import { RenderQueue } from "./RenderQueue";
import { RenderWorld } from "./RenderWorld";
// Capture the immutable ABI once; queue updates then use local numeric offsets.
const {
  transform: transformWord,
  material: materialWord,
  jointOffset: jointOffsetWord,
  jointCount: jointCountWord,
  morphWeightOffset: morphWeightOffsetWord,
  morphTargetCount: morphTargetCountWord,
  objectId: objectIdWord,
  flags: flagsWord,
  morphDeltaOffset: morphDeltaOffsetWord,
  morphVertexCount: morphVertexCountWord,
  meshId: meshIdWord,
  padding: paddingWord,
} = InstanceWord;
const instanceWords = INSTANCE_WORDS;

/** Pack queue order into the shared shader ABI; all instances reuse asset buffers. */
export class InstanceManager {
  readonly data: Uint32Array;
  constructor(capacity: number) {
    this.data = new Uint32Array(capacity * INSTANCE_WORDS);
  }
  update(queue: RenderQueue, world: RenderWorld, meshes?: MeshManager): void {
    for (let i = 0; i < queue.count; i++) {
      const object = queue.order[i]!,
        offset = i * instanceWords;
      this.data[offset + transformWord] = world.transformIndex[object]!;
      this.data[offset + materialWord] = world.materialId[object]!;
      this.data[offset + jointOffsetWord] = world.jointOffset[object]!;
      this.data[offset + jointCountWord] = world.jointCounts[object]!;
      // These offsets reference shared weight/delta arenas, preserving original vertex IDs.
      this.data[offset + morphWeightOffsetWord] = world.morphOffset[object]!;
      this.data[offset + morphTargetCountWord] = world.morphCounts[object]!;
      this.data[offset + objectIdWord] = world.entityId[object]!;
      this.data[offset + flagsWord] =
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
      this.data[offset + morphDeltaOffsetWord] = mesh?.morphOffset ?? 0;
      this.data[offset + morphVertexCountWord] = mesh?.morph?.vertexCount ?? 0;
      this.data[offset + meshIdWord] = world.meshId[object]!;
      this.data[offset + paddingWord] = 0;
    }
  }
}
