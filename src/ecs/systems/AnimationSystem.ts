import { MorphStatePool } from "../../animation/MorphStatePool";
import { RuntimeAsset } from "../../assets/gltf/RuntimeAsset";
import { World } from "../World";
import { AnimationClip } from "../../animation/AnimationClip";
import { Animator, MorphState } from "../../animation/Animator";
/** ECS update stage; render submission never traverses asset animation data. */
export class AnimationSystem {
  private readonly clips = new WeakMap<RuntimeAsset, AnimationClip[]>();
  readonly animators: Animator[] = [];
  activeAnimators = 0;
  readonly morphPool = new MorphStatePool();
  readonly morphStates = this.morphPool.states;
  attach(
    asset: RuntimeAsset,
    entities: Int32Array,
    world: World,
  ): Animator | undefined {
    const morphs = new Map<number, MorphState>();
    for (let node = 0; node < entities.length; node++) {
      const entity = entities[node]!,
        data = asset.nodes[node]!;
      if (entity < 0 || data.mesh < 0) continue;
      const mesh = asset.meshes[data.mesh]!,
        count = mesh.primitives[0]?.targets.length ?? 0;
      if (!count) continue;
      for (const p of mesh.primitives)
        if (p.targets.length !== count)
          throw new Error("Inconsistent mesh morph target count");
      const initial = data.weights.length ? data.weights : mesh.weights;
      if (initial.length && initial.length !== count)
        throw new Error("Invalid default morph weights");
      const id = this.morphPool.create(count, initial),
        state = this.morphStates[id]!;
      morphs.set(entity, state);
      world.morphs.add(entity);
      world.morphs.stateId[entity] = id;
      for (
        let child = world.transforms.firstChild[entity]!;
        child !== -1;
        child = world.transforms.nextSibling[child]!
      )
        if (world.meshes.has[child]) {
          world.morphs.add(child);
          world.morphs.stateId[child] = id;
        }
    }
    if (!asset.animations.length) return;
    let clips = this.clips.get(asset);
    if (!clips) {
      clips = asset.animations.map(AnimationClip.fromAsset);
      this.clips.set(asset, clips);
    }
    const animator = new Animator(clips, world, entities, morphs);
    const id = this.animators.push(animator) - 1;
    for (const entity of entities)
      if (entity >= 0) {
        world.animators.add(entity);
        world.animators.animatorId[entity] = id;
      }
    return animator;
  }
  /** Remove controllers only when every bound ECS node has been detached. */
  releaseUnused(world: World): void {
    const used = new Set<number>();
    for (let e = 0; e < world.nextEntity; e++)
      if (world.alive[e] && world.animators.has[e])
        used.add(world.animators.animatorId[e]!);
    const remap = new Map<number, number>();
    let count = 0;
    for (let id = 0; id < this.animators.length; id++) {
      if (!used.has(id)) {
        this.animators[id]!.pause();
        continue;
      }
      remap.set(id, count);
      this.animators[count++] = this.animators[id]!;
    }
    this.animators.length = count;
    for (let e = 0; e < world.nextEntity; e++)
      if (world.alive[e] && world.animators.has[e])
        world.animators.animatorId[e] = remap.get(
          world.animators.animatorId[e]!,
        )!;
    this.morphPool.releaseUnused(world);
  }
  update(deltaSeconds: number): void {
    this.activeAnimators = 0;
    for (const animator of this.animators) {
      animator.update(deltaSeconds);
      if (animator.playing) this.activeAnimators++;
    }
  }
}
