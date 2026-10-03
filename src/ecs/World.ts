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
  destroy(entity: number): void {
    if (!this.alive[entity]) return;
    for (const store of this.stores) store.remove(entity);
    this.alive[entity] = 0;
    this.count--;
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
