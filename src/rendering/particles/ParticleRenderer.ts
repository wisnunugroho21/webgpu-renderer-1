import { ParticleVisibility } from "./ParticleVisibility";
import { particleAtlasMipLevels } from "../../particles/ParticleAtlas";
import { MipGenerator } from "../materials/MipGenerator";
import { UnifiedTransparency } from "../UnifiedTransparency";
import { RenderQueue } from "../RenderQueue";
import { BatchBuilder } from "../BatchBuilder";
import { PARTICLE_CURVE_WORDS } from "../../particles/ParticleCurves";
import { ParticleDepthSorter } from "./ParticleDepthSorter";
import type { GPUContext } from "../../gpu/GPUContext";
import type { Resources } from "../../gpu/Resources";
import type { Camera } from "../Camera";
import type { ParticleSystem } from "../../particles/ParticleSystem";
import * as particleLayout from "../../particles/ParticleLayout";
import {
  createParticleResources,
  createParticlePipelines,
} from "./createParticleResources";

// Capture immutable ABI constants once, keeping imported-value access outside tight loops.
const {
  PARTICLE_WORDS,
  PARTICLE_BYTES,
  PARTICLE_BIRTH,
  PARTICLE_DRAG,
  PARTICLE_VELOCITY,
  PARTICLE_GRAVITY,
  PARTICLE_BLEND,
  PARTICLE_FRAME_WORDS,
  PARTICLE_FRAME_BYTES,
} = particleLayout;

/** GPU owner for a persistent particle snapshot; bounded retained billboard/ribbon pipelines cover alpha/additive and direct/HDR targets. */
export class ParticleRenderer {
  readonly transparency: UnifiedTransparency;
  private readonly emptyQueue = new RenderQueue(0);
  private readonly emptyBatches = new BatchBuilder(0);
  private readonly visibility = new ParticleVisibility();
  private readonly billboardVisible: Uint8Array;
  private readonly ribbonVisible: Uint8Array;
  private atlasLevels = 1;
  drawCalls = 0;
  uploadBytes = 0;
  recordUploadBytes = 0;
  trailUploadBytes = 0;
  private trailBuffer?: GPUBuffer;
  private trailOrderBuffer?: GPUBuffer;
  private trailGroup?: GPUBindGroup;
  private trailPipelines?: ReturnType<typeof createParticlePipelines>;
  readonly trailOrder: Uint32Array;
  private readonly previousTrailOrder: Uint32Array;
  readonly trailDepths: Float32Array;
  private readonly trailSorter: ParticleDepthSorter;
  private uploadedTrails = -1;
  private previousTrailCount = -1;
  trailAlphaCount = 0;
  alphaCount = 0;
  billboardCount = 0;
  ribbonCount = 0;
  private buffer?: GPUBuffer;
  private orderBuffer?: GPUBuffer;
  private frameBuffer?: GPUBuffer;
  private group?: GPUBindGroup;
  private prepared?: ReturnType<typeof createParticleResources>;
  private atlasTexture?: GPUTexture;
  private atlasRevision = -1;
  private depthView?: GPUTextureView;
  private uploadedCurves = 0;
  private direct: GPURenderPipeline[] = [];
  private hdr: GPURenderPipeline[] = [];
  private readonly frame = new Float32Array(PARTICLE_FRAME_WORDS);
  readonly order: Uint32Array;
  private readonly previousOrder: Uint32Array;
  readonly depths: Float32Array;
  private readonly depthSorter: ParticleDepthSorter;
  private previousCount = -1;
  private uploaded = -1;
  private readonly detach: () => void;
  /** Allocate bounded CPU ordering scratch and attach explicit enable-time GPU setup. */
  constructor(
    private readonly gpu: GPUContext,
    private readonly resources: Resources,
    readonly system: ParticleSystem,
    meshCapacity = 0,
    private mipmaps?: MipGenerator,
  ) {
    this.transparency = new UnifiedTransparency(
      meshCapacity * 8 + system.capacity + system.trails.segmentCapacity,
    );
    this.billboardVisible = new Uint8Array(system.capacity);
    this.ribbonVisible = new Uint8Array(system.trails.segmentCapacity);
    this.order = new Uint32Array(system.capacity);
    this.previousOrder = new Uint32Array(system.capacity);
    this.depths = new Float32Array(system.capacity);
    this.depthSorter = new ParticleDepthSorter(this.depths);
    this.trailOrder = new Uint32Array(system.trails.segmentCapacity);
    this.previousTrailOrder = new Uint32Array(system.trails.segmentCapacity);
    this.trailDepths = new Float32Array(system.trails.segmentCapacity);
    this.trailSorter = new ParticleDepthSorter(this.trailDepths);
    this.detach = system.attach(() => {
      /* Prepare only at enable/recovery boundaries, never once per particle. */ this.prepare();
    });
  }
  /** Prepare shared storage, immutable bindings and all bounded variants once on this device. */
  private prepare(): void {
    if (this.gpu.lost || this.gpu.disposed) return;
    if (this.buffer) {
      this.refreshAtlas();
      this.prepareTrails();
      return;
    }
    const prepared = createParticleResources(
      this.gpu,
      this.resources,
      this.system.records.byteLength,
      this.order.byteLength,
      this.system.curves.records.byteLength,
    );
    this.prepared = prepared;
    this.buffer = prepared.buffer;
    this.orderBuffer = prepared.orderBuffer;
    this.frameBuffer = prepared.frameBuffer;
    this.direct = prepared.direct;
    this.hdr = prepared.hdr;
    this.refreshAtlas();
    this.prepareTrails();
  }
  /** Prepare ribbon storage and four shared-layout variants only on controller creation/enable/recovery. */
  private prepareTrails(): void {
    const p = this.prepared;
    if (!p || this.trailBuffer || !this.system.trails.installed) return;
    this.trailBuffer = this.resources.buffers.create({
      label: "Shared particle ribbons",
      size: this.system.trails.records.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.trailOrderBuffer = this.resources.buffers.create({
      label: "Shared ribbon order",
      size: this.trailOrder.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.trailPipelines = createParticlePipelines(
      this.gpu,
      this.resources,
      p.module,
      p.pipelineLayout,
      "trailVS",
    );
    this.refreshGroup();
  }
  /** Rebind sampled depth only at target resize; a read-only attachment can also be sampled. */
  setDepth(view: GPUTextureView): void {
    this.depthView = view;
    this.refreshGroup();
  }
  /** Replace the shared atlas at installation/recovery boundaries and retain copied CPU provenance. */
  private refreshAtlas(): void {
    if (!this.prepared || this.atlasRevision === this.system.atlasRevision)
      return;
    const atlas = this.system.atlas;
    this.atlasLevels = particleAtlasMipLevels(atlas);
    const texture = this.resources.textures.create({
      label: "Particle atlas",
      mipLevelCount: this.atlasLevels,
      size: [atlas?.width ?? 1, atlas?.height ?? 1],
      format: atlas?.colorSpace === "linear" ? "rgba8unorm" : "rgba8unorm-srgb",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        (this.atlasLevels > 1 ? GPUTextureUsage.RENDER_ATTACHMENT : 0),
    });
    this.gpu.queue.writeTexture(
      { texture },
      atlas?.pixels ?? new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: (atlas?.width ?? 1) * 4 },
      [atlas?.width ?? 1, atlas?.height ?? 1],
    );
    if (this.atlasLevels > 1) {
      this.mipmaps ??= new MipGenerator(this.gpu.device, this.resources);
      this.mipmaps.generate(texture, true);
    }
    if (this.atlasTexture) this.resources.textures.destroy(this.atlasTexture);
    this.atlasTexture = texture;
    this.atlasRevision = this.system.atlasRevision;
    this.refreshGroup();
  }
  /** Create the immutable shared group at cold atlas/resize boundaries, never in encode. */
  private refreshGroup(): void {
    const p = this.prepared;
    if (!p || !this.depthView || !this.atlasTexture) return;
    this.group = this.createGroup(p.buffer, p.orderBuffer);
    if (this.trailBuffer)
      this.trailGroup = this.createGroup(
        this.trailBuffer,
        this.trailOrderBuffer!,
      );
  }
  /** Bind one packed snapshot to shared frame/profile/atlas/depth inputs; called only on cold changes. */
  private createGroup(buffer: GPUBuffer, orderBuffer: GPUBuffer): GPUBindGroup {
    const p = this.prepared!;
    return this.gpu.device.createBindGroup({
      layout: p.layout,
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: { buffer: orderBuffer } },
        { binding: 2, resource: { buffer: p.frameBuffer } },
        { binding: 3, resource: { buffer: p.curveBuffer } },
        { binding: 4, resource: this.atlasTexture!.createView() },
        { binding: 5, resource: p.sampler },
        { binding: 6, resource: this.depthView! },
      ],
    });
  }
  /** Evaluate the WGSL ballistic/drag center and return positive forward camera depth.
   * View matrices are column-major; sorting uses center depth, not per-vertex or mesh-interleaved transparency. */
  private depth(index: number, view: Float32Array): number {
    const r = this.system.records,
      o = index * PARTICLE_WORDS;
    const age = Math.max(0, this.system.time - r[o + PARTICLE_BIRTH]!);
    const drag = r[o + PARTICLE_DRAG]!;
    const integral = drag > 0.0001 ? (1 - Math.exp(-drag * age)) / drag : age;
    const acceleration =
      drag > 0.0001 ? (age - integral) / drag : 0.5 * age * age;
    let z = view[14]!;
    for (let axis = 0; axis < 3; axis++)
      z +=
        view[axis * 4 + 2]! *
        (r[o + axis]! +
          r[o + PARTICLE_VELOCITY + axis]! * integral +
          r[o + PARTICLE_GRAVITY + axis]! * acceleration);
    return -z;
  }
  /** Refresh shared records and sorted streams once before unified transparency submission. */
  prepareFrame(camera: Camera): void {
    this.drawCalls =
      this.uploadBytes =
      this.recordUploadBytes =
      this.trailUploadBytes =
        0;
    this.alphaCount =
      this.trailAlphaCount =
      this.billboardCount =
      this.ribbonCount =
        0;
    const system = this.system;
    if (!system.enabled || !this.buffer) return;
    system.trails.prepare();
    if (!system.count && !system.trails.count) return;
    if (system.cullingEnabled) {
      this.visibility.prepare(camera.viewProjection);
      for (let i = 0; i < system.count; i++)
        this.billboardVisible[i] = this.visibility.billboard(system, i) ? 1 : 0;
      for (let i = 0; i < system.trails.count; i++)
        this.ribbonVisible[i] = this.visibility.ribbon(system, i) ? 1 : 0;
    }
    const full = this.uploaded < 0;
    if (full || this.uploaded !== system.revision) {
      const start = full ? 0 : Math.min(system.count, system.dirtyStart);
      const end = full ? system.count : Math.min(system.count, system.dirtyEnd);
      if (end > start) {
        this.recordUploadBytes = (end - start) * PARTICLE_BYTES;
        this.gpu.queue.writeBuffer(
          this.buffer,
          start * PARTICLE_BYTES,
          system.records.buffer,
          start * PARTICLE_BYTES,
          this.recordUploadBytes,
        );
      }
      this.uploaded = system.revision;
      system.dirtyStart = Infinity;
      system.dirtyEnd = 0;
    }
    let alphaCount = 0;
    for (let i = 0; i < system.count; i++)
      if (
        system.records[i * PARTICLE_WORDS + PARTICLE_BLEND] === 0 &&
        (!system.cullingEnabled || this.billboardVisible[i])
      ) {
        this.depths[i] = this.depth(i, camera.view);
        this.order[alphaCount++] = i;
      }
    this.depthSorter.sort(this.order, alphaCount);
    let end = alphaCount;
    for (let i = 0; i < system.count; i++)
      if (
        system.records[i * PARTICLE_WORDS + PARTICLE_BLEND] === 1 &&
        (!system.cullingEnabled || this.billboardVisible[i])
      )
        this.order[end++] = i;
    let changed = this.previousCount !== end;
    for (let i = 0; i < end && !changed; i++)
      changed = this.order[i] !== this.previousOrder[i];
    this.uploadBytes = this.recordUploadBytes + PARTICLE_FRAME_BYTES;
    if (changed) {
      this.gpu.queue.writeBuffer(
        this.orderBuffer!,
        0,
        this.order.buffer,
        0,
        end * 4,
      );
      for (let i = 0; i < end; i++) this.previousOrder[i] = this.order[i]!;
      this.previousCount = end;
      this.uploadBytes += end * 4;
    }
    if (this.uploadedCurves !== system.curves.count) {
      const start = this.uploadedCurves * PARTICLE_CURVE_WORDS * 4;
      const bytes =
        (system.curves.count - this.uploadedCurves) * PARTICLE_CURVE_WORDS * 4;
      this.gpu.queue.writeBuffer(
        this.prepared!.curveBuffer,
        start,
        system.curves.records.buffer,
        start,
        bytes,
      );
      this.uploadedCurves = system.curves.count;
      this.uploadBytes += bytes;
    }
    this.frame.set(camera.viewProjection);
    const view = camera.view;
    this.frame[16] = view[0]!;
    this.frame[17] = view[4]!;
    this.frame[18] = view[8]!;
    this.frame[20] = view[1]!;
    this.frame[21] = view[5]!;
    this.frame[22] = view[9]!;
    this.frame[24] = system.time;
    this.frame[25] = this.atlasLevels;
    this.frame[28] = camera.projection[10]!;
    this.frame[29] = camera.projection[14]!;
    this.frame[30] = camera.projectionType === "orthographic" ? 1 : 0;
    const atlas = system.atlas;
    this.frame[32] = atlas?.columns ?? 1;
    this.frame[33] = atlas?.rows ?? 1;
    this.frame[34] = atlas?.width ?? 1;
    this.frame[35] = atlas?.height ?? 1;
    this.gpu.queue.writeBuffer(this.frameBuffer!, 0, this.frame);
    this.uploadTrails(camera);
    this.alphaCount = alphaCount;
    this.billboardCount = end;
  }

  /** Preserve standalone effect composition using the same merged alpha schedule as the renderer. */
  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    depth: GPUTextureView,
    camera: Camera,
    hdr: boolean,
  ): void {
    this.prepareFrame(camera);
    if (!this.billboardCount && !this.ribbonCount) return;
    this.transparency.build(this.emptyQueue, this.emptyBatches, this);
    const pass = encoder.beginRenderPass({
      label: "Unified particle transparency",
      colorAttachments: [{ view: target, loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: { view: depth, depthReadOnly: true },
    });
    for (let run = 0; run < this.transparency.count; run++) {
      this.drawRange(
        pass,
        hdr,
        this.transparency.kind[run] === 2,
        this.transparency.first[run]!,
        this.transparency.length[run]!,
      );
    }
    this.drawAdditive(pass, hdr);
    pass.end();
  }

  /** Submit a contiguous sorted billboard/ribbon range using retained pipelines and bindings. */
  drawRange(
    pass: GPURenderPassEncoder,
    hdr: boolean,
    ribbon: boolean,
    first: number,
    count: number,
    additive = false,
  ): void {
    if (!count) return;
    const pipelines = ribbon
      ? hdr
        ? this.trailPipelines!.hdr
        : this.trailPipelines!.direct
      : hdr
        ? this.hdr
        : this.direct;
    pass.setPipeline(pipelines[additive ? 1 : 0]!);
    pass.setBindGroup(0, ribbon ? this.trailGroup! : this.group!);
    pass.draw(6, count, 0, first);
    this.drawCalls++;
  }

  /** Additive effects follow every alpha layer; their mutual order does not affect composition. */
  drawAdditive(pass: GPURenderPassEncoder, hdr: boolean): void {
    this.drawRange(
      pass,
      hdr,
      false,
      this.alphaCount,
      this.billboardCount - this.alphaCount,
      true,
    );
    this.drawRange(
      pass,
      hdr,
      true,
      this.trailAlphaCount,
      this.ribbonCount - this.trailAlphaCount,
      true,
    );
  }
  /** Refresh only changed ribbon rows/order; point-age shading uses the already uploaded shared clock. */
  private uploadTrails(camera: Camera): void {
    const t = this.system.trails;
    if (!this.trailBuffer || !t.count) return;
    if (this.uploadedTrails !== t.revision) {
      const start =
        this.uploadedTrails < 0 ? 0 : Math.min(t.count, t.dirtyStart);
      const end =
        this.uploadedTrails < 0 ? t.count : Math.min(t.count, t.dirtyEnd);
      if (end > start) {
        const bytes = (end - start) * PARTICLE_BYTES;
        this.gpu.queue.writeBuffer(
          this.trailBuffer,
          start * PARTICLE_BYTES,
          t.records.buffer,
          start * PARTICLE_BYTES,
          bytes,
        );
        this.trailUploadBytes += bytes;
      }
      this.uploadedTrails = t.revision;
      t.dirtyStart = Infinity;
      t.dirtyEnd = 0;
    }
    let alpha = 0;
    const r = t.records,
      view = camera.view;
    for (let i = 0; i < t.count; i++)
      if (
        r[i * PARTICLE_WORDS + PARTICLE_BLEND] === 0 &&
        (!this.system.cullingEnabled || this.ribbonVisible[i])
      ) {
        const o = i * PARTICLE_WORDS;
        let z = view[14]!;
        for (let axis = 0; axis < 3; axis++)
          z += view[axis * 4 + 2]! * (r[o + axis]! + r[o + 4 + axis]!) * 0.5;
        this.trailDepths[i] = -z;
        this.trailOrder[alpha++] = i;
      }
    this.trailSorter.sort(this.trailOrder, alpha);
    let end = alpha;
    for (let i = 0; i < t.count; i++)
      if (
        r[i * PARTICLE_WORDS + PARTICLE_BLEND] === 1 &&
        (!this.system.cullingEnabled || this.ribbonVisible[i])
      )
        this.trailOrder[end++] = i;
    let changed = this.previousTrailCount !== end;
    for (let i = 0; i < end && !changed; i++)
      changed = this.trailOrder[i] !== this.previousTrailOrder[i];
    if (changed) {
      this.gpu.queue.writeBuffer(
        this.trailOrderBuffer!,
        0,
        this.trailOrder.buffer,
        0,
        end * 4,
      );
      for (let i = 0; i < end; i++)
        this.previousTrailOrder[i] = this.trailOrder[i]!;
      this.previousTrailCount = end;
      this.trailUploadBytes += end * 4;
    }
    this.trailAlphaCount = alpha;
    this.ribbonCount = end;
    this.uploadBytes += this.trailUploadBytes;
  }
  /** Detach setup notifications; the shared Resources owner destroys GPU storage at renderer disposal. */
  dispose(): void {
    this.detach();
  }
}
