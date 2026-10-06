import * as temporalLayout from "./TemporalLayout";
import { createTemporalResources } from "./createTemporalResources";
import { prepareTemporalTargets } from "./prepareTemporalTargets";
import { Mat4 } from "../../math/Mat4";
import { GPUPass } from "../../profiling/GPUProfiler";
import type { Renderer } from "../Renderer";
import type { TargetLease } from "../../gpu/TransientTargetPool";
import { MotionHistory } from "./MotionHistory";
// Resolve immutable ABI widths once, outside object packing/upload loops.
const {
  MOTION_OBJECT_WORDS,
  MOTION_OBJECT_BYTES,
  MOTION_FRAME_WORDS,
  MOTION_FRAME_BYTES,
  TEMPORAL_SETTINGS_WORDS,
  TEMPORAL_SETTINGS_BYTES,
} = temporalLayout;
/** Opt-in shared motion raster and persistent ping-pong color/depth; configuration owns all GPU setup. */
const HALTON_JITTER_X = [0, -0.25, 0.25, -0.375, 0.125, -0.125, 0.375, -0.4375];
const HALTON_JITTER_Y = [
  -1 / 6,
  1 / 6,
  -7 / 18,
  -1 / 18,
  5 / 18,
  -5 / 18,
  1 / 18,
  7 / 18,
];
export class TemporalAntialiasing {
  private active = false;
  private history?: MotionHistory;
  private current?: GPUBuffer;
  private uploadedCurrent?: Uint32Array;
  private uploadedPrevious?: Uint32Array;
  private uploadedCount = 0;
  private previous?: GPUBuffer;
  private frameBuffer?: GPUBuffer;
  private settingsBuffer?: GPUBuffer;
  private motionGroup?: GPUBindGroup;
  private resolveLayout?: GPUBindGroupLayout;
  private pipelines: GPURenderPipeline[] = [];
  private resolvePipeline?: GPURenderPipeline;
  private targets: TargetLease[] = [];
  private groups: GPUBindGroup[] = [];
  private depth?: GPUTextureView;
  private scene?: GPUTexture;
  private width = 0;
  private height = 0;
  private index = 0;
  private stamp = 0;
  private historyValid = false;
  private blend = 0.9;
  private tolerance = 0.0001;
  jitter = true;
  uploadBytes = 0;
  drawCalls = 0;
  private readonly frame = new Float32Array(MOTION_FRAME_WORDS);
  private readonly words = new Uint32Array(this.frame.buffer);
  private readonly previousCamera = new Float32Array(16);
  private readonly settings = new Float32Array(TEMPORAL_SETTINGS_WORDS);
  private jitterX = 0;
  private jitterY = 0;
  private oldJitterX = 0;
  private oldJitterY = 0;
  private deltaX = 0;
  private deltaY = 0;
  private readonly inverse = new Float32Array(16);
  /** Retain renderer owners; default construction creates no optional GPU resources. */
  constructor(private readonly renderer: Renderer) {}
  /** Expose the retained diagnostic motion texture without allocating a view or reading its pixels. */
  get motionTexture(): GPUTexture | undefined {
    return this.targets[0]?.texture;
  }
  /** Report whether temporal processing is configured. */
  get enabled(): boolean {
    return this.active;
  }
  /** Prepare fixed pipelines/storage and reset history only at explicit mode changes. */
  set enabled(value: boolean) {
    if (value === this.active) return;
    if (value && this.renderer.antialiasing !== "taa") {
      this.renderer.antialiasing = "taa";
      return;
    }
    if (!value && this.renderer.antialiasing === "taa") {
      this.renderer.antialiasing = "none";
      return;
    }
    if (value) this.prepare();
    this.active = value;
    if (!value) this.renderer.camera.setJitter(0, 0);
    this.reset();
  }
  /** Return the accepted history contribution. */
  get feedback(): number {
    return this.blend;
  }
  /** Keep feedback below one so history can always converge to new radiance. */
  set feedback(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 0.98)
      throw new RangeError("TAA feedback must be 0–0.98");
    this.blend = value;
  }
  /** Return standard-Z history rejection tolerance. */
  get depthTolerance(): number {
    return this.tolerance;
  }
  /** Configure a finite standard-Z depth tolerance for the authored clip range. */
  set depthTolerance(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 0.01)
      throw new RangeError("TAA depth tolerance must be 0–0.01");
    this.tolerance = value;
  }
  /** Explicit camera cuts invalidate history without waiting for or reading the GPU. */
  reset(): void {
    this.historyValid = false;
    this.stamp = 0;
    this.history?.reset();
  }
  /** Reject combined previous-pose storage before optional mode changes allocate CPU or GPU histories. */
  preflight(): void {
    const { world, gpu } = this.renderer;
    const currentBytes = world.capacity * MOTION_OBJECT_WORDS * 4;
    const previousBytes =
      currentBytes +
      world.jointCapacity * 16 * 4 +
      Math.max(4, world.morphCapacity) * 4;
    const limit = Math.min(
      gpu.device.limits.maxStorageBufferBindingSize,
      gpu.device.limits.maxBufferSize,
    );
    if (Math.max(currentBytes, previousBytes) > limit)
      throw new RangeError(
        `TAA pose storage requires ${previousBytes} bytes; device binding/buffer limit is ${limit}`,
      );
  }
  /** Create bounded topology/sidedness variants and shared storage once on this device. */
  private prepare(): void {
    if (this.history) return;
    this.preflight();
    const prepared = createTemporalResources(this.renderer);
    this.history = prepared.history;
    this.uploadedCurrent = prepared.uploadedCurrent;
    this.uploadedPrevious = prepared.uploadedPrevious;
    this.current = prepared.current;
    this.previous = prepared.previous;
    this.frameBuffer = prepared.frameBuffer;
    this.settingsBuffer = prepared.settingsBuffer;
    this.motionGroup = prepared.motionGroup;
    this.resolveLayout = prepared.resolveLayout;
    this.resolvePipeline = prepared.resolvePipeline;
    this.pipelines = prepared.pipelines;
  }
  /** Rebuild persistent histories and groups at enable/resize boundaries, excluding them from graph aliasing. */
  resize(
    scene: GPUTexture | undefined,
    depth: GPUTextureView | undefined,
  ): void {
    if (!this.active || !scene || !depth) return;
    if (this.scene === scene && this.depth === depth) return;
    for (const target of this.targets) target.release();
    this.scene = scene;
    this.depth = depth;
    this.width = scene.width;
    this.height = scene.height;
    this.targets = [];
    this.groups = [];
    prepareTemporalTargets(
      this.renderer,
      scene,
      depth,
      this.resolveLayout!,
      this.settingsBuffer!,
      this.targets,
      this.groups,
    );
    this.index = 0;
    this.reset();
  }
  /** Apply a bounded eight-sample subpixel sequence before camera uniforms and culling are prepared. */
  begin(): void {
    if (!this.active) {
      this.uploadBytes = this.drawCalls = 0;
      return;
    }
    const sample = this.stamp % 8;
    this.jitterX = this.jitter ? HALTON_JITTER_X[sample]! / this.width : 0;
    this.jitterY = this.jitter ? -HALTON_JITTER_Y[sample]! / this.height : 0;
    this.renderer.camera.setJitter(this.jitterX * 2, -this.jitterY * 2);
  }
  /** Coalesce changed packed rows; stationary scenes transfer camera controls rather than full object pools. */
  private uploadObjects(
    buffer: GPUBuffer,
    words: Uint32Array,
    uploaded: Uint32Array,
    count: number,
  ): number {
    let first = -1,
      bytes = 0;
    for (let object = 0; object <= count; object++) {
      let dirty = object < count && object >= this.uploadedCount;
      if (object < count)
        for (
          let word = object * MOTION_OBJECT_WORDS;
          word < (object + 1) * MOTION_OBJECT_WORDS;
          word++
        ) {
          if (words[word] !== uploaded[word]) dirty = true;
          uploaded[word] = words[word]!;
        }
      if (dirty) {
        if (first < 0) first = object;
        continue;
      }
      if (first < 0) continue;
      const offset = first * MOTION_OBJECT_BYTES,
        size = (object - first) * MOTION_OBJECT_BYTES;
      this.renderer.gpu.queue.writeBuffer(
        buffer,
        offset,
        words.buffer,
        offset,
        size,
      );
      bytes += size;
      first = -1;
    }
    return bytes;
  }
  /** Draw opaque motion against final depth and capture opaque color for per-pixel transparency rejection. */
  encodeMotion(encoder: GPUCommandEncoder): void {
    if (!this.active || !this.scene) return;
    const r = this.renderer,
      w = r.world,
      h = this.history!;
    this.uploadBytes = this.drawCalls = 0;
    h.prepare(w, r.materials);
    for (let i = 0; i < w.count; i++) {
      const mesh = r.meshes.get(w.meshId[i]!),
        o = i * MOTION_OBJECT_WORDS;
      h.currentWords[o + 24] = mesh.morphOffset ?? 0;
      h.currentWords[o + 25] = mesh.deformationVertexCount ?? 0;
      // GPU-selected LOD geometry may differ from the CPU snapshot; conservatively reject its history.
      if (r.submissionMode === "gpu-indirect" && w.lodGroup[i]! >= 0)
        h.currentWords[o + 27] = 0;
    }
    this.frame.set(r.camera.viewProjection, 0);
    this.frame.set(this.previousCamera, 16);
    this.words[32] = h.jointWord / 4;
    this.words[33] = h.morphWord / 4;
    this.uploadBytes =
      this.uploadObjects(
        this.current!,
        h.currentWords,
        this.uploadedCurrent!,
        w.count,
      ) +
      this.uploadObjects(
        this.previous!,
        h.previousWords,
        this.uploadedPrevious!,
        w.count,
      );
    this.uploadedCount = w.count;
    r.gpu.queue.writeBuffer(this.frameBuffer!, 0, this.frame);
    this.uploadBytes += MOTION_FRAME_BYTES;
    const pass = encoder.beginRenderPass({
      label: "Temporal motion",
      timestampWrites: r.gpuProfiler.writes(GPUPass.motion),
      colorAttachments: [
        {
          view: this.targets[0]!.view,
          clearValue: [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: { view: this.depth!, depthReadOnly: true },
    });
    pass.setBindGroup(0, this.motionGroup!);
    for (let n = 0; n < r.queue.count; n++) {
      const i = r.queue.order[n]!,
        material = w.materialId[i]!;
      if (r.materials.alphaMode[material] === 2) continue;
      const mesh = r.meshes.get(w.meshId[i]!);
      pass.setPipeline(
        this.pipelines[r.materials.doubleSided[material]! * 3 + mesh.topology]!,
      );
      pass.setBindGroup(1, r.textures.groups[material] ?? r.textures.fallback);
      pass.setVertexBuffer(0, mesh.vertex);
      pass.setIndexBuffer(mesh.index, "uint32");
      let count = 1;
      while (n + count < r.queue.count) {
        const next = r.queue.order[n + count]!;
        if (
          next !== i + count ||
          w.meshId[next] !== w.meshId[i] ||
          w.materialId[next] !== material
        )
          break;
        count++;
      }
      pass.drawIndexed(mesh.indexCount, count, 0, 0, i);
      n += count - 1;
      this.drawCalls++;
    }
    pass.end();
    encoder.copyTextureToTexture(
      { texture: this.scene },
      { texture: this.targets[1]!.texture },
      [this.width, this.height],
    );
    if (w.jointCount)
      encoder.copyBufferToBuffer(
        r.joints.buffer,
        0,
        this.previous!,
        h.jointWord * 4,
        w.jointCount * 64,
      );
    if (w.morphWeightCount)
      encoder.copyBufferToBuffer(
        r.morphWeights.buffer,
        0,
        this.previous!,
        h.morphWord * 4,
        w.morphWeightCount * 4,
      );
    h.capture(w, r.materials);
    this.previousCamera.set(r.camera.viewProjection);
    this.deltaX = this.jitterX - this.oldJitterX;
    this.deltaY = this.jitterY - this.oldJitterY;
    this.oldJitterX = this.jitterX;
    this.oldJitterY = this.jitterY;
  }
  /** Resolve into the opposite persistent history and copy back before existing bloom/presentation. */
  encodeResolve(encoder: GPUCommandEncoder): void {
    if (!this.active || !this.scene) return;
    const next = 1 - this.index,
      color = this.targets[2 + next * 2]!,
      depth = this.targets[3 + next * 2]!;
    this.settings.set([
      this.historyValid ? 1 : 0,
      this.blend,
      this.tolerance,
      0,
    ]);
    Mat4.invert(this.inverse, this.renderer.camera.viewProjection);
    this.settings.set(this.inverse, 4);
    this.settings.set(this.frame.subarray(16, 32), 20);
    this.settings[36] = this.deltaX;
    this.settings[37] = this.deltaY;
    this.renderer.gpu.queue.writeBuffer(this.settingsBuffer!, 0, this.settings);
    this.uploadBytes += TEMPORAL_SETTINGS_BYTES;
    const pass = encoder.beginRenderPass({
      label: "Temporal resolve",
      timestampWrites: this.renderer.gpuProfiler.writes(
        GPUPass.temporalResolve,
      ),
      colorAttachments: [
        { view: color.view, loadOp: "clear", storeOp: "store" },
        { view: depth.view, loadOp: "clear", storeOp: "store" },
      ],
    });
    pass.setPipeline(this.resolvePipeline!);
    pass.setBindGroup(0, this.groups[this.index]!);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToTexture(
      { texture: color.texture },
      { texture: this.scene },
      [this.width, this.height],
    );
    this.index = next;
    this.historyValid = true;
    this.stamp++;
  }
  /** Release leases on final renderer disposal; the resource owner retires shared buffers/pipelines. */
  dispose(): void {
    for (const target of this.targets) target.release();
    this.targets = [];
  }
}
