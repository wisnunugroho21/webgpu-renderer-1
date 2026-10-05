import { createShadowResources } from "./createShadowResources";
import { GPUProfiler, GPUPass } from "../../profiling/GPUProfiler";
import { ShadowSceneCache } from "./ShadowSceneCache";
import { cascadeSplit } from "./CascadeSplits";
import { Frustum } from "../../math/Frustum";
import { FrustumCuller } from "../../visibility/FrustumCuller";
import { Resources } from "../../gpu/Resources";
import { DynamicBufferAllocator } from "../../gpu/DynamicBufferAllocator";
import { RendererStats } from "../../profiling/RendererStats";
import { RenderWorld } from "../RenderWorld";
import { Camera } from "../Camera";
import { MeshManager } from "../MeshManager";
import { MaterialManager } from "../materials/MaterialManager";
import { MaterialTextures } from "../materials/MaterialTextures";
import { RenderQueue } from "../RenderQueue";
import { RenderSorter } from "../RenderSorter";
import { InstanceManager } from "../InstanceManager";
import { ShadowCamera } from "./ShadowCamera";
/** Cold fixed resources, compact numeric shadow metadata, shared caster instance pool. */
export class ShadowManager {
  readonly resolution = 1024;
  readonly capacity = 16;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly sampler: GPUSampler;
  readonly buffer: GPUBuffer;
  readonly data = new Float32Array(16 * 20);
  readonly uniforms = new Float32Array(16 * 64);
  readonly queue: RenderQueue;
  readonly instances: InstanceManager;
  private readonly sorter = new RenderSorter();
  private readonly camera = new ShadowCamera();
  private readonly views: GPUTextureView[];
  readonly groups: GPUBindGroup[];
  readonly passGroups: GPUBindGroup[];
  readonly descriptors: GPURenderPipelineDescriptor[];
  private readonly pipelines: GPURenderPipeline[];
  private readonly previous = new Float32Array(16 * 20).fill(NaN);
  private layerCount = 0;
  private instanceOffset = 0;
  private uniformOffset = 0;
  enabled = true;
  cacheEnabled = true;
  private readonly sceneCache: ShadowSceneCache;
  private readonly valid = new Uint8Array(16);
  private readonly drawLayer = new Uint8Array(16);
  private cascadeCount = 1;
  private distance = 30;
  /** Returns the configured number of directional shadow cascades. */
  get cascades(): number {
    return this.cascadeCount;
  }
  /** Validates the directional cascade count against the supported fixed shadow layout. */
  set cascades(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 4)
      throw new Error("Shadow cascades must be 1–4");
    this.cascadeCount = value;
  }
  /** Returns the maximum camera distance covered by directional shadows in world units. */
  get shadowDistance(): number {
    return this.distance;
  }
  /** Validates the farthest camera distance covered by directional shadows. */
  set shadowDistance(value: number) {
    if (!Number.isFinite(value) || value <= 0)
      throw new Error("Shadow distance must be positive");
    this.distance = value;
  }
  cullingEnabled = true;
  private readonly frustum = new Frustum();
  private readonly culler: FrustumCuller;
  private readonly visible: Uint8Array;
  /** Initializes shared directional/local depth maps, caster queues and shadow settings. */
  constructor(
    private readonly device: GPUDevice,
    resources: Resources,
    private readonly dynamic: DynamicBufferAllocator,
    world: RenderWorld,
    bindings: readonly GPUBuffer[],
    private readonly meshes: MeshManager,
    private readonly materials: MaterialManager,
    private readonly textures: MaterialTextures,
    vertexBuffers: GPUVertexBufferLayout[],
  ) {
    this.sceneCache = new ShadowSceneCache(world);
    this.culler = new FrustumCuller(world.capacity);
    this.visible = new Uint8Array(world.capacity);
    this.queue = new RenderQueue(world.capacity);
    this.instances = new InstanceManager(world.capacity);
    const prepared = createShadowResources({
      device,
      resources,
      dynamic,
      world,
      bindings,
      textures,
      vertexBuffers,
      resolution: this.resolution,
      capacity: this.capacity,
      dataBytes: this.data.byteLength,
    });
    this.texture = prepared.texture;
    this.view = prepared.view;
    this.views = prepared.views;
    this.sampler = prepared.sampler;
    this.buffer = prepared.buffer;
    this.groups = prepared.groups;
    this.passGroups = prepared.passGroups;
    this.descriptors = prepared.descriptors;
    this.pipelines = prepared.pipelines;
  }
  /** Preflight total layer use and local projections before publishing any light-to-layer metadata. */
  private validateLights(world: RenderWorld, camera: Camera): void {
    if (!this.enabled) return;
    let layers = 0,
      directional = 0;
    for (let light = 0; light < world.lightCount; light++) {
      if (!world.lightShadow[light]) continue;
      const o = light * 16,
        type = world.lightData[o + 11]!;
      if (!type) {
        if (Math.min(camera.far, this.shadowDistance) <= camera.near) continue;
        if (++directional > 4)
          throw new Error("Directional shadow light capacity exceeded (4)");
        layers += this.cascades;
      } else {
        const near = world.lightShadowSettings[light * 3] || 0.05;
        const far = world.lightData[o + 3] || this.shadowDistance;
        if (
          near >= far ||
          !Number.isFinite(Math.fround((near * far) / (far - near)))
        )
          throw new Error("Local shadow range must exceed shadowNear");
        if (
          type === 2 &&
          !(world.lightData[o + 13]! > 0 && world.lightData[o + 13]! < 1)
        )
          throw new Error("Invalid shadow-casting spot cone");
        layers += type === 1 ? 6 : 1;
      }
    }
    if (layers > this.capacity)
      throw new Error("Shared shadow layer capacity exceeded (16)");
  }
  /** Selects light projections/casters, compares cached scene state and packs changed shadow parameters. */
  prepare(
    world: RenderWorld,
    camera: Camera,
    queue: GPUQueue,
    stats: RendererStats,
  ): void {
    this.validateLights(world, camera);
    this.layerCount = 0;
    for (let light = 0; light < world.lightCount; light++) {
      const offset = light * 16,
        type = world.lightData[offset + 11]!,
        cast =
          this.enabled &&
          world.lightShadow[light] !== 0 &&
          (type !== 0 ||
            Math.min(camera.far, this.shadowDistance) > camera.near);
      const first = cast ? this.layerCount + 1 : 0,
        count = cast ? (type === 0 ? this.cascades : type === 1 ? 6 : 1) : 0;
      if (
        world.lightData[offset + 14] !== first ||
        world.lightData[offset + 15] !== count
      ) {
        world.lightData[offset + 14] = first;
        world.lightData[offset + 15] = count;
        world.lightDirty[light] = 1;
      }
      if (!cast) continue;
      let near =
        type === 0 ? camera.near : world.lightShadowSettings[light * 3] || 0.05;
      for (let cascade = 1; cascade <= count; cascade++) {
        const far =
          type === 0
            ? cascadeSplit(
                camera.near,
                Math.min(camera.far, this.shadowDistance),
                cascade,
                this.cascades,
                camera.projectionType === "orthographic" ? 0 : 0.6,
              )
            : world.lightData[offset + 3] || this.shadowDistance;
        if (type === 0)
          this.camera.fit(camera, world, light, near, far, this.resolution);
        else this.camera.fitLocal(world, light, cascade - 1, near, far);
        const layer = this.layerCount++,
          o = layer * 20;
        this.data.set(this.camera.matrix, o);
        this.data[o + 16] = far;
        this.data[o + 17] = world.lightShadowSettings[light * 3 + 1] ?? 0.0001;
        this.data[o + 18] = world.lightShadowSettings[light * 3 + 2] ?? 0.005;
        this.data[o + 19] = 0;
        this.uniforms.set(this.camera.matrix, layer * 64);
        let changed = false;
        for (let k = 0; k < 20; k++)
          if (this.previous[o + k] !== this.data[o + k]) changed = true;
        this.drawLayer[layer] =
          !this.cacheEnabled || changed || !this.valid[layer] ? 1 : 0;
        if (changed) {
          queue.writeBuffer(this.buffer, o * 4, this.data.buffer, o * 4, 80);
          this.previous.set(this.data.subarray(o, o + 20), o);
          stats.shadowUploadBytes += 80;
        }
        if (type === 0) near = far;
      }
    }
    if (!this.layerCount) return;
    this.queue.build(world, this.materials, camera.view);
    this.sorter.sort(this.queue, world, true);
    this.queue.count = this.queue.opaqueCount + this.queue.maskCount; // Blended surfaces do not cast opaque depth.
    this.instances.update(this.queue, world, this.meshes);
    if (
      this.sceneCache.update(
        world,
        this.instances.data,
        this.queue.count,
        this.materials.revision,
      )
    )
      this.drawLayer.fill(1, 0, this.layerCount);
    let draws = 0;
    for (let layer = 0; layer < this.layerCount; layer++)
      draws += this.drawLayer[layer]!;
    if (!draws) return;
    this.instanceOffset = this.dynamic.allocate(
      Math.max(48, this.queue.count * 48),
      this.device.limits.minStorageBufferOffsetAlignment,
    );
    this.dynamic.write(
      this.instanceOffset,
      this.instances.data.subarray(0, Math.max(12, this.queue.count * 12)),
    );
    this.uniformOffset = this.dynamic.allocate(this.layerCount * 256);
    this.dynamic.write(
      this.uniformOffset,
      this.uniforms.subarray(0, this.layerCount * 64),
    );
  }
  /** Renders required shadow layers with shared deformation and alpha-mask handling. */
  encode(
    encoder: GPUCommandEncoder,
    world: RenderWorld,
    stats: RendererStats,
    profiler?: GPUProfiler,
  ): void {
    for (let layer = 0; layer < this.layerCount; layer++) {
      if (!this.drawLayer[layer]) {
        stats.shadowCacheHits++;
        continue;
      }
      this.frustum.setFromMatrix(
        this.data.subarray(layer * 20, layer * 20 + 16),
      );
      this.visible.fill(0, 0, world.count);
      for (let i = 0; i < world.count; i++)
        this.visible[i] =
          !this.cullingEnabled || this.culler.intersects(world, i, this.frustum)
            ? 1
            : 0;
      for (let i = 0; i < this.queue.count; i++)
        if (!this.visible[this.queue.order[i]!]) stats.shadowRejected++;

      const pass = encoder.beginRenderPass({
        label: "Shared light shadow",
        timestampWrites: profiler?.writes(GPUPass.shadow),
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.views[layer]!,
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      pass.setBindGroup(0, this.groups[this.dynamic.frameSlot]!, [
        this.instanceOffset,
      ]);
      pass.setBindGroup(2, this.passGroups[this.dynamic.frameSlot]!, [
        this.uniformOffset + layer * 256,
      ]);
      let first = 0;
      while (first < this.queue.count) {
        if (!this.visible[this.queue.order[first]!]) {
          first++;
          continue;
        }
        const object = this.queue.order[first]!,
          mesh = world.meshId[object]!,
          material = world.materialId[object]!,
          geometry = this.meshes.get(mesh),
          pipeline =
            this.materials.doubleSided[material]! * 3 + geometry.topology;
        let end = first + 1;
        while (
          end < this.queue.count &&
          this.visible[this.queue.order[end]!] !== 0 &&
          world.meshId[this.queue.order[end]!] === mesh &&
          world.materialId[this.queue.order[end]!] === material
        )
          end++;
        pass.setPipeline(this.pipelines[pipeline]!);
        pass.setBindGroup(
          1,
          this.textures.groups[material] ?? this.textures.fallback,
        );
        pass.setVertexBuffer(0, geometry.vertex);
        pass.setIndexBuffer(geometry.index, "uint32");
        pass.drawIndexed(geometry.indexCount, end - first, 0, 0, first);
        stats.shadowDrawCalls++;
        if (geometry.topology === 0)
          stats.shadowTriangles += (geometry.indexCount / 3) * (end - first);
        first = end;
      }
      pass.end();
      this.valid[layer] = 1;
      stats.shadowPasses++;
    }
  }
}
