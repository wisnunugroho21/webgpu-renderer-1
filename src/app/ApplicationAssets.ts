import { JSONDocument } from "@gltf-transform/core";
import { GPUContext } from "../gpu/GPUContext";
import { World } from "../ecs/World";
import { EntityHandle } from "../ecs/Entity";
import { AnimationSystem } from "../ecs/systems/AnimationSystem";
import { SkeletonRegistry } from "../animation/skinning/SkeletonRegistry";
import { Renderer } from "../rendering/Renderer";
import { MaterialManager } from "../rendering/materials/MaterialManager";
import { AssetInstances, InstanceLifetime } from "../assets/AssetInstances";
import { AssetLoader } from "../assets/AssetLoader";
import { GLTFLoader } from "../assets/gltf/GLTFLoader";
import { RuntimeAsset } from "../assets/gltf/RuntimeAsset";
import { instantiate, UploadedAsset } from "../assets/gltf/instantiate";
import { uploadAsset, releaseUploadedAsset } from "../assets/uploadAsset";
import { AssetDecoder } from "../assets/workers/AssetDecoder";
import { transferableBuffers } from "../assets/workers/transfer";

/** Independently disposable scene; nodes exclude renderer-created primitive children. */
export interface AssetInstance {
  readonly url: string;
  readonly nodes: readonly EntityHandle[];
  readonly animator: InstanceLifetime["animator"];
  readonly disposed: boolean;
  dispose(): Promise<void>;
}

/** Cold asset operations access the current renderer so device recovery cannot leave stale owners. */
interface ApplicationAssetContext {
  readonly world: World;
  readonly animations: AnimationSystem;
  readonly skeletons: SkeletonRegistry;
  readonly materials: MaterialManager;
  readonly gltf: GLTFLoader;
  renderer(): Renderer;
  gpu(): GPUContext;
  isDisposing(): boolean;
  checkDevice(): void;
  refreshSnapshot(): void;
}

/** Owns asset leases, scene allocation/rollback, decoding and unload vetoes; never runs in a frame. */
export class ApplicationAssets {
  readonly instances: AssetInstances;
  readonly decoder: AssetDecoder;
  constructor(private readonly context: ApplicationAssetContext) {
    this.instances = new AssetInstances(
      context.world,
      context.animations,
      context.skeletons,
    );
    this.decoder = new AssetDecoder(context.gltf);
  }
  private get world() {
    return this.context.world;
  }
  private get animations() {
    return this.context.animations;
  }
  private get skeletons() {
    return this.context.skeletons;
  }
  private get materials() {
    return this.context.materials;
  }
  private get renderer() {
    return this.context.renderer();
  }
  private get gpu() {
    return this.context.gpu();
  }
  private get gltf() {
    return this.context.gltf;
  }
  private get disposing() {
    return this.context.isDisposing();
  }
  readonly loader = new AssetLoader<JSONDocument, RuntimeAsset, UploadedAsset>(
    (url, signal) => this.gltf.fetch(url, signal),
    (data, signal) => this.decoder.decode(data, signal),
    (asset, signal) => this.uploadAsset(asset, signal),
    undefined,
    {
      decodedBytes: (asset) =>
        transferableBuffers(asset).reduce(
          (bytes, buffer) => bytes + buffer.byteLength,
          0,
        ),
      beforeUnload: (uploaded, asset, url) => {
        if (!this.disposing) this.assertCanUnloadAsset(url, uploaded);
        this.instances.detach(url, asset);
        this.context.refreshSnapshot();
      },
      release: (uploaded) =>
        releaseUploadedAsset(
          uploaded,
          this.renderer.meshes,
          this.materials,
          this.renderer.textures,
          () => this.gpu.queue.onSubmittedWorkDone(),
        ),
      canEvict: (record) => {
        if (!record.uploaded) return true;
        try {
          this.assertCanUnloadAsset(record.url, record.uploaded);
          return true;
        } catch {
          return false;
        }
      },
    },
  );
  private async uploadAsset(
    asset: RuntimeAsset,
    signal: AbortSignal,
  ): Promise<UploadedAsset> {
    this.context.checkDevice();
    return uploadAsset(
      asset,
      this.renderer.meshes,
      this.materials,
      this.renderer.textures,
      () => {
        signal.throwIfAborted();
        this.context.checkDevice();
      },
    );
  }
  /** Each call creates a scene instance; cached GPU assets remain shared. */
  async loadAsset(url: string): Promise<Uint32Array> {
    return (await this.loadAssetInstance(url, false)).nodes;
  }
  /** Opt-in recyclable entities. Retain handles; resolve indices only for immediate SoA access. */
  async loadAssetHandles(url: string): Promise<readonly EntityHandle[]> {
    return (await this.loadAssetInstance(url, true)).handles;
  }
  async instantiateAsset(url: string): Promise<AssetInstance> {
    const instance = await this.loadAssetInstance(url, true);
    return Object.freeze({
      url,
      nodes: instance.handles,
      animator: instance.lifetime.animator,
      get disposed() {
        return instance.lifetime.disposed;
      },
      dispose: async () => {
        // CPU detachment performs no GPU wait or shared-buffer destruction.
        if (instance.lifetime.disposed) return;
        instance.lifetime.dispose();
        this.context.refreshSnapshot();
      },
    });
  }
  private async loadAssetInstance(
    url: string,
    recycle: boolean,
  ): Promise<{
    nodes: Uint32Array;
    handles: readonly EntityHandle[];
    lifetime: InstanceLifetime;
  }> {
    this.context.checkDevice();
    const release = this.loader.retain(url);
    try {
      const uploaded = await this.loader.load(url);
      this.context.checkDevice();
      const record = this.loader.records.get(url);
      if (
        !record?.decoded ||
        record.state !== "Ready" ||
        record.uploaded !== uploaded
      )
        throw new Error("Asset was unloaded before instantiation");
      const asset = record.decoded,
        allocated: EntityHandle[] = [],
        handles = new Map<number, EntityHandle>();
      try {
        const nodes = instantiate(
          asset,
          this.world,
          this.renderer.meshes,
          this.materials,
          asset.defaultScene,
          this.animations,
          this.skeletons,
          uploaded,
          {
            available: recycle
              ? this.world.availableHandleSlots
              : this.world.capacity - this.world.nextEntity,
            create: () => {
              const handle = recycle
                ? this.world.createHandle()
                : this.world.handle(this.world.create());
              allocated.push(handle);
              handles.set(handle.index, handle);
              return handle.index;
            },
          },
        );
        const lifetime = this.instances.addEntities(
          url,
          allocated,
          release,
          asset,
        );
        return {
          nodes,
          lifetime,
          handles: Object.freeze(
            Array.from(nodes, (index) => handles.get(index)!),
          ),
        };
      } catch (error) {
        this.instances.rollbackEntities(allocated, asset);
        throw error;
      }
    } catch (error) {
      release();
      throw error;
    }
  }

  private assertCanUnloadAsset(url: string, uploaded: UploadedAsset): void {
    this.instances.assertCanUnload(url, uploaded);
    const ids = new Set(uploaded.meshIds.flat());
    for (const group of this.renderer.lodGroups.entries)
      if (group.meshes.some((id) => ids.has(id)))
        throw new Error(
          "Asset is referenced by an LOD group; detach it before unloading",
        );
    if (this.renderer.streaming.referencesAsset(uploaded))
      throw new Error(
        "Asset is referenced by streaming; detach it before unloading",
      );
    const materialIds = new Set(uploaded.materialIds);
    for (let id = 0; id < this.renderer.textures.groups.length; id++)
      if (
        !materialIds.has(id) &&
        uploaded.textureGroups?.includes(this.renderer.textures.groups[id]!)
      )
        throw new Error("Asset texture group is bound to an external material");
  }
}
