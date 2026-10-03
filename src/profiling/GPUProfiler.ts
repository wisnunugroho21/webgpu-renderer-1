import { Resources } from "../gpu/Resources";
export const GPUPass = {
  shadow: 0,
  clusters: 1,
  color: 2,
  depth: 3,
  hiz: 4,
  visibility: 5,
  occlusion: 6,
  compaction: 7,
  indirect: 8,
  lod: 9,
  geometry: 10,
} as const;
export interface GPUTiming {
  frame: number;
  pass: number;
  milliseconds: number;
}
/** Opt-in timestamps; explicit readSamples is outside frame processing. No normal-frame readback. */
export class GPUProfiler {
  readonly supported: boolean;
  enabled = false;
  droppedCaptures = 0;
  private readonly query?: GPUQuerySet;
  private readonly resolve?: GPUBuffer;
  private readonly readback: GPUBuffer[] = [];
  private readonly descriptors: GPURenderPassTimestampWrites[][] = [];
  private readonly counts = new Uint32Array(3);
  private readonly occupied = new Uint8Array(3);
  private readonly submitted = new Uint8Array(3);
  private readonly frameIds = new Uint32Array(3);
  private readonly labels = new Uint8Array(3 * 32);
  private slot = -1;
  constructor(device: GPUDevice, resources: Resources) {
    this.supported = device.features.has("timestamp-query");
    if (!this.supported) return;
    this.query = device.createQuerySet({
      label: "Pass timestamp ring",
      type: "timestamp",
      count: 3 * 64,
    });
    this.resolve = resources.buffers.create({
      label: "Timestamp resolve ring",
      size: 3 * 512,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    for (let slot = 0; slot < 3; slot++) {
      this.readback.push(
        resources.buffers.create({
          label: "Explicit profiler readback",
          size: 512,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
      );
      this.descriptors.push(
        Array.from({ length: 32 }, (_, pass) => ({
          querySet: this.query!,
          beginningOfPassWriteIndex: slot * 64 + pass * 2,
          endOfPassWriteIndex: slot * 64 + pass * 2 + 1,
        })),
      );
    }
  }
  beginFrame(frame: number): void {
    this.slot = -1;
    if (!this.enabled || !this.supported) return;
    const slot = frame % 3;
    if (this.occupied[slot]) {
      this.droppedCaptures++;
      return;
    }
    this.slot = slot;
    this.occupied[slot] = 1;
    this.counts[slot] = 0;
    this.frameIds[slot] = frame;
  }
  writes(pass: number): GPURenderPassTimestampWrites | undefined {
    if (this.slot < 0) return;
    const count = this.counts[this.slot]!;
    if (count === 32) return;
    this.labels[this.slot * 32 + count] = pass;
    this.counts[this.slot] = count + 1;
    return this.descriptors[this.slot]![count];
  }
  resolveFrame(encoder: GPUCommandEncoder): void {
    const slot = this.slot;
    if (slot < 0) return;
    const count = this.counts[slot]!;
    if (count) {
      encoder.resolveQuerySet(
        this.query!,
        slot * 64,
        count * 2,
        this.resolve!,
        slot * 512,
      );
      encoder.copyBufferToBuffer(
        this.resolve!,
        slot * 512,
        this.readback[slot]!,
        0,
        count * 16,
      );
      this.submitted[slot] = 1;
    } else this.occupied[slot] = 0;
    this.slot = -1;
  }
  async readSamples(): Promise<GPUTiming[]> {
    if (this.enabled)
      throw new Error("Pause timestamp capture before explicit readback");
    const samples: GPUTiming[] = [];
    for (let slot = 0; slot < 3; slot++)
      if (this.submitted[slot]) {
        const buffer = this.readback[slot]!;
        await buffer.mapAsync(GPUMapMode.READ);
        const ticks = new BigUint64Array(buffer.getMappedRange());
        for (let pass = 0; pass < this.counts[slot]!; pass++)
          samples.push({
            frame: this.frameIds[slot]!,
            pass: this.labels[slot * 32 + pass]!,
            milliseconds: Number(ticks[pass * 2 + 1]! - ticks[pass * 2]!) / 1e6,
          });
        buffer.unmap();
        this.submitted[slot] = this.occupied[slot] = 0;
      }
    return samples;
  }
  dispose(): void {
    this.query?.destroy();
  }
}
