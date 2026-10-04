import { EntityHandle } from "./Entity";
import { ComponentStore } from "./components/ComponentStore";
import { TransformStore } from "./components/TransformStore";
import { MeshRendererStore } from "./components/MeshRendererStore";
import { BoundsStore } from "./components/BoundsStore";
import { AnimatorStore } from "./components/AnimatorStore";
import { SkinStore } from "./components/SkinStore";
import { MorphStore } from "./components/MorphStore";
import { LightStore } from "./components/LightStore";
import { CameraStore } from "./components/CameraStore";
export class World {
  readonly alive: Uint8Array;
  readonly generation: Float64Array;
  private readonly recyclable: Uint8Array;
  private readonly free: Uint32Array;
  private freeCount = 0;
  private readonly handles = new WeakSet<EntityHandle>();
  readonly transforms: TransformStore;
  readonly meshes: MeshRendererStore;
  readonly bounds: BoundsStore;
  readonly animators: AnimatorStore;
  readonly skins: SkinStore;
  readonly morphs: MorphStore;
  readonly lights: LightStore;
  readonly cameras: CameraStore;
  private readonly stores: ComponentStore[];
  nextEntity = 0;
  count = 0;
  constructor(readonly capacity = 16384) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0)
      throw new Error("Invalid world capacity");
    this.alive = new Uint8Array(capacity);
    this.generation = new Float64Array(capacity);
    this.recyclable = new Uint8Array(capacity);
    this.free = new Uint32Array(capacity);
    this.transforms = new TransformStore(capacity);
    this.meshes = new MeshRendererStore(capacity);
    this.bounds = new BoundsStore(capacity);
    this.animators = new AnimatorStore(capacity);
    this.skins = new SkinStore(capacity);
    this.morphs = new MorphStore(capacity);
    this.lights = new LightStore(capacity);
    this.cameras = new CameraStore(capacity);
    this.stores = [
      this.transforms,
      this.meshes,
      this.bounds,
      this.animators,
      this.skins,
      this.morphs,
      this.lights,
      this.cameras,
    ];
  }
  /** Monotonic numeric IDs avoid stale-ID aliasing; capacity exhaustion is explicit. */
  create(): number {
    if (this.nextEntity === this.capacity)
      throw new Error("World capacity exceeded");
    const id = this.nextEntity++;
    this.alive[id] = 1;
    this.count++;
    return id;
  }
  /** Only handle-created slots recycle. Legacy numeric identities never alias replacements. */
  createHandle(): EntityHandle {
    let index: number;
    if (this.freeCount) {
      index = this.free[--this.freeCount]!;
      this.alive[index] = 1;
      this.count++;
    } else {
      index = this.create();
      this.recyclable[index] = 1;
    }
    return this.handle(index);
  }
  get availableHandleSlots(): number {
    return this.capacity - this.nextEntity + this.freeCount;
  }
  handle(index: number): EntityHandle {
    if (!Number.isInteger(index) || !this.alive[index])
      throw new Error("Unknown entity");
    const handle = Object.freeze({
      index,
      generation: this.generation[index]!,
    });
    this.handles.add(handle);
    return handle;
  }
  resolve(handle: EntityHandle): number | null {
    return this.handles.has(handle) &&
      this.alive[handle.index] &&
      this.generation[handle.index] === handle.generation
      ? handle.index
      : null;
  }
  require(handle: EntityHandle): number {
    const index = this.resolve(handle);
    if (index === null) throw new Error("Stale or foreign entity handle");
    return index;
  }
  destroy(entity: number | EntityHandle): void {
    if (typeof entity !== "number") {
      const index = this.resolve(entity);
      if (index === null) return;
      entity = index;
    }
    if (!this.alive[entity]) return;
    for (const store of this.stores) store.remove(entity);
    this.alive[entity] = 0;
    this.count--;
    // Retire an exhausted generation rather than wrap and revive ancient references.
    if (this.generation[entity]! < Number.MAX_SAFE_INTEGER) {
      this.generation[entity] = this.generation[entity]! + 1;
      if (this.recyclable[entity]) this.free[this.freeCount++] = entity;
    }
  }
  query(out: Uint32Array, ...stores: ComponentStore[]): number {
    let count = 0;
    for (let e = 0; e < this.nextEntity; e++) {
      if (!this.alive[e] || stores.some((store) => !store.has[e])) continue;
      if (count === out.length)
        throw new Error("Query output capacity exceeded");
      out[count++] = e;
    }
    return count;
  }
}
