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
  /** Releases this owner or scene lifetime according to its independent ownership contract. */
  dispose(): Promise<void>;
}

/** Cold asset operations access the current renderer so device recovery cannot leave stale owners. */
interface ApplicationAssetContext {
  readonly world: World;
  readonly animations: AnimationSystem;
  readonly skeletons: SkeletonRegistry;
  readonly materials: MaterialManager;
  readonly gltf: GLTFLoader;
  /** Returns the currently published renderer, including replacements after device recovery. */
  renderer(): Renderer;
  /** Returns the currently published GPU context for cold resource operations. */
  gpu(): GPUContext;
  /** Reports whether teardown prevents further resource publication. */
  isDisposing(): boolean;
  /** Throws if the current device cannot accept asset publication. */
  checkDevice(): void;
  /** Refreshes scene membership after asset publication or removal. */
  refreshSnapshot(): void;
}

/** Owns asset leases, scene allocation/rollback, decoding and unload vetoes; never runs in a frame. */
export class ApplicationAssets {
  readonly instances: AssetInstances;
  readonly decoder: AssetDecoder;
  /** Initializes transactional scene loading, instantiation and unloading. */
  constructor(private readonly context: ApplicationAssetContext) {
    this.instances = new AssetInstances(
      context.world,
      context.animations,
      context.skeletons,
    );
    this.decoder = new AssetDecoder(context.gltf);
  }
  /** Returns the persistent entity world shared by asset instances. */
  private get world() {
    return this.context.world;
  }
  /** Returns the animation registry used to attach and detach imported animators. */
  private get animations() {
    return this.context.animations;
  }
  /** Returns the skeleton registry shared by imported scenes. */
  private get skeletons() {
    return this.context.skeletons;
  }
  /** Returns shared CPU material descriptions retained across device recovery. */
  private get materials() {
    return this.context.materials;
  }
  /** Resolves the current renderer so uploads do not retain a pre-recovery GPU owner. */
  private get renderer() {
    return this.context.renderer();
  }
  /** Resolves the current GPU context at the asset transaction boundary. */
  private get gpu() {
    return this.context.gpu();
  }
  /** Returns the shared glTF fetch/decode adapter. */
  private get gltf() {
    return this.context.gltf;
  }
  /** Reports whether application teardown prevents further scene publication. */
  private get disposing() {
    return this.context.isDisposing();
  }
  readonly loader = new AssetLoader<JSONDocument, RuntimeAsset, UploadedAsset>(
    (url, signal) =>
      /** Delegates this operation to this.gltf.fetch. */ this.gltf.fetch(
        url,
        signal,
      ),
    (data, signal) =>
      /** Delegates this operation to this.decoder.decode. */ this.decoder.decode(
        data,
        signal,
      ),
    (asset, signal) =>
      /** Delegates this operation to this.uploadAsset. */ this.uploadAsset(
        asset,
        signal,
      ),
    undefined,
    {
      /** Accumulates the input entries into one result. */
      decodedBytes: (asset) =>
        transferableBuffers(asset).reduce(
          (bytes, buffer) =>
            /** Computes the bytes + buffer.byteLength result. */ bytes +
            buffer.byteLength,
          0,
        ),
      /** Applies this.assertCanUnloadAsset, this.instances.detach, this.context.refreshSnapshot to before unload. */
      beforeUnload: (uploaded, asset, url) => {
        if (!this.disposing) this.assertCanUnloadAsset(url, uploaded);
        this.instances.detach(url, asset);
        this.context.refreshSnapshot();
      },
      /** Delegates this operation to releaseUploadedAsset. */
      release: (uploaded) =>
        releaseUploadedAsset(
          uploaded,
          this.renderer.meshes,
          this.materials,
          this.renderer.textures,
          () =>
            /** Delegates this operation to this.gpu.queue.onSubmittedWorkDone. */ this.gpu.queue.onSubmittedWorkDone(),
        ),
      /** Returns false. */
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
  /** Uploads decoded shared mesh/material resources using the current device and cancellation boundary. */
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
        // Checks cancellation and current-device validity between yielded asset upload chunks.

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
  /** Returns an immutable independent scene lease; disposing it despawns its entities while retaining shared assets. */
  async instantiateAsset(url: string): Promise<AssetInstance> {
    const instance = await this.loadAssetInstance(url, true);
    return Object.freeze({
      url,
      nodes: instance.handles,
      animator: instance.lifetime.animator,
      /** Reports whether this scene lease has already detached its entities. */
      get disposed() {
        return instance.lifetime.disposed;
      },
      /** Despawns this scene lease and refreshes membership while retaining shared GPU assets for other scenes. */
      dispose: async () => {
        // CPU detachment performs no GPU wait or shared-buffer destruction.
        if (instance.lifetime.disposed) return;
        instance.lifetime.dispose();
        this.context.refreshSnapshot();
      },
    });
  }
  /** Shares canonical loading while publishing an independently disposable scene lease. */
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
            /** Instantiates an uploaded asset transactionally and rolls back partially published entities on failure. */
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
            Array.from(nodes, (index) =>
              /** Returns handles.get(index)!. */ handles.get(index)!,
            ),
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

  /** Checks scene and streaming consumers before an asset can release shared GPU resources. */
  private assertCanUnloadAsset(url: string, uploaded: UploadedAsset): void {
    this.instances.assertCanUnload(url, uploaded);
    const ids = new Set(uploaded.meshIds.flat());
    for (const group of this.renderer.lodGroups.entries)
      if (
        group.meshes.some((id) =>
          /** Delegates this operation to ids.has. */ ids.has(id),
        )
      )
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
