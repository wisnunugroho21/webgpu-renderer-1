import { ParticleDepthSorter } from "./ParticleDepthSorter";
import type { GPUContext } from "../../gpu/GPUContext";
import type { Resources } from "../../gpu/Resources";
import type { Camera } from "../Camera";
import type { ParticleSystem } from "../../particles/ParticleSystem";
import * as particleLayout from "../../particles/ParticleLayout";
import { createParticleResources } from "./createParticleResources";

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

/** GPU owner for a persistent particle snapshot; four retained pipelines cover alpha/additive and direct/HDR targets. */
export class ParticleRenderer {
  drawCalls = 0;
  uploadBytes = 0;
  recordUploadBytes = 0;
  private buffer?: GPUBuffer;
  private orderBuffer?: GPUBuffer;
  private frameBuffer?: GPUBuffer;
  private group?: GPUBindGroup;
  private direct: GPURenderPipeline[] = [];
  private hdr: GPURenderPipeline[] = [];
  private readonly frame = new Float32Array(PARTICLE_FRAME_WORDS);
  private readonly order: Uint32Array;
  private readonly previousOrder: Uint32Array;
  private readonly depths: Float32Array;
  private readonly depthSorter: ParticleDepthSorter;
  private previousCount = -1;
  private uploaded = -1;
  private readonly detach: () => void;
  /** Allocate bounded CPU ordering scratch and attach explicit enable-time GPU setup. */
  constructor(
    private readonly gpu: GPUContext,
    private readonly resources: Resources,
    readonly system: ParticleSystem,
  ) {
    this.order = new Uint32Array(system.capacity);
    this.previousOrder = new Uint32Array(system.capacity);
    this.depths = new Float32Array(system.capacity);
    this.depthSorter = new ParticleDepthSorter(this.depths);
    this.detach = system.attach(() => {
      /* Prepare only at enable/recovery boundaries, never once per particle. */ this.prepare();
    });
  }
  /** Prepare shared storage, immutable bindings and all bounded variants once on this device. */
  private prepare(): void {
    if (this.buffer || this.gpu.lost || this.gpu.disposed) return;
    const prepared = createParticleResources(
      this.gpu,
      this.resources,
      this.system.records.byteLength,
      this.order.byteLength,
    );
    this.buffer = prepared.buffer;
    this.orderBuffer = prepared.orderBuffer;
    this.frameBuffer = prepared.frameBuffer;
    this.group = prepared.group;
    this.direct = prepared.direct;
    this.hdr = prepared.hdr;
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
  /** Encode onto already-rendered scene color with read-only depth; no submission or completion wait.
   * Refresh dirty records, sort the alpha prefix, append additive indices and draw at most two groups.
   * hdr selects the half-float scene target, including FXAA-only presentation. Empty/disabled pools reset counters and skip work. */
  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    depth: GPUTextureView,
    camera: Camera,
    hdr: boolean,
  ): void {
    this.drawCalls = this.uploadBytes = this.recordUploadBytes = 0;
    const system = this.system;
    if (!system.enabled || !system.count || !this.buffer) return;
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
      if (system.records[i * PARTICLE_WORDS + PARTICLE_BLEND] === 0) {
        this.depths[i] = this.depth(i, camera.view);
        this.order[alphaCount++] = i;
      }
    this.depthSorter.sort(this.order, alphaCount);
    let end = alphaCount;
    for (let i = 0; i < system.count; i++)
      if (system.records[i * PARTICLE_WORDS + PARTICLE_BLEND] === 1)
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
    this.frame.set(camera.viewProjection);
    const view = camera.view;
    this.frame[16] = view[0]!;
    this.frame[17] = view[4]!;
    this.frame[18] = view[8]!;
    this.frame[20] = view[1]!;
    this.frame[21] = view[5]!;
    this.frame[22] = view[9]!;
    this.frame[24] = system.time;
    this.gpu.queue.writeBuffer(this.frameBuffer!, 0, this.frame);
    const pass = encoder.beginRenderPass({
      label: "Particles",
      colorAttachments: [{ view: target, loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: { view: depth, depthReadOnly: true },
    });
    const pipelines = hdr ? this.hdr : this.direct;
    pass.setBindGroup(0, this.group!);
    if (alphaCount) {
      pass.setPipeline(pipelines[0]!);
      pass.draw(6, alphaCount);
      this.drawCalls++;
    }
    if (end > alphaCount) {
      pass.setPipeline(pipelines[1]!);
      pass.draw(6, end - alphaCount, 0, alphaCount);
      this.drawCalls++;
    }
    pass.end();
  }
  /** Detach setup notifications; the shared Resources owner destroys GPU storage at renderer disposal. */
  dispose(): void {
    this.detach();
  }
}
