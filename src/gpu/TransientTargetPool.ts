import { TextureManager } from "./TextureManager";
import { textureMemory } from "./TextureMemory";

/** A retained default view and a single ownership lease; release only between frame submissions. */
export interface TargetLease {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  /** Quarantine this lease until already-submitted GPU work completes. */
  release(): void;
}
interface Entry {
  key: string;
  texture: GPUTexture;
  view: GPUTextureView;
  bytes: number;
  state: "active" | "retired" | "idle";
}
/** Normalize descriptor defaults and ignore labels; exact usage/view formats prevent incompatible reuse. */
export function targetDescriptor(descriptor: GPUTextureDescriptor): {
  descriptor: GPUTextureDescriptor;
  key: string;
} {
  const size = descriptor.size;
  const extent =
    Symbol.iterator in Object(size)
      ? Array.from(size as Iterable<number>)
      : [
          (size as GPUExtent3DDict).width,
          (size as GPUExtent3DDict).height ?? 1,
          (size as GPUExtent3DDict).depthOrArrayLayers ?? 1,
        ];
  const width = extent[0]!,
    height = extent[1] ?? 1,
    depth = extent[2] ?? 1,
    mips = descriptor.mipLevelCount ?? 1,
    samples = descriptor.sampleCount ?? 1,
    dimension = descriptor.dimension ?? "2d",
    formats = [...(descriptor.viewFormats ?? [])].sort();
  if (
    [width, height, depth, mips, samples].some((v) => {
      // Reject fractional/empty extents before allocation or lifetime planning.
      return !Number.isSafeInteger(v) || v <= 0;
    }) ||
    !Number.isInteger(descriptor.usage) ||
    (descriptor.usage & ~31) !== 0 ||
    descriptor.usage <= 0 ||
    (dimension !== "1d" && dimension !== "2d" && dimension !== "3d")
  )
    throw new Error("Invalid transient target descriptor");
  const normalized: GPUTextureDescriptor = {
    ...descriptor,
    size: [width, height, depth],
    dimension,
    mipLevelCount: mips,
    sampleCount: samples,
    viewFormats: formats,
  };
  Object.freeze(normalized.size);
  Object.freeze(formats);
  textureMemory(normalized);
  return {
    descriptor: Object.freeze(normalized),
    key: JSON.stringify([
      width,
      height,
      depth,
      dimension,
      descriptor.format,
      mips,
      samples,
      descriptor.usage,
      formats,
    ]),
  };
}
/** Device-local, bounded idle texture cache. Acquisition is cold; frame encoding never calls it. */
export class TransientTargetPool {
  private readonly entries = new Set<Entry>();
  private readonly idle: Entry[] = [];
  private readonly pending = new Set<Promise<void>>();
  private disposed = false;
  readonly stats = {
    hits: 0,
    misses: 0,
    activeBytes: 0,
    retiredBytes: 0,
    idleBytes: 0,
    evictions: 0,
  };
  /** Set independent idle count/byte limits; active targets remain governed by their owner. */
  constructor(
    private readonly textures: TextureManager,
    private readonly completion: () => Promise<unknown>,
    readonly maxIdleBytes = 64 * 1024 * 1024,
    readonly maxIdleTargets = 32,
  ) {
    if (
      ![maxIdleBytes, maxIdleTargets].every((v) => {
        // Idle bounds must be finite integer capacities, including zero to disable retention.
        return Number.isSafeInteger(v) && v >= 0;
      })
    )
      throw new Error("Invalid transient pool limits");
  }
  /** Borrow a compatible completed target or create one; contents are undefined until its first write. */
  acquire(descriptor: GPUTextureDescriptor): TargetLease {
    if (this.disposed) throw new Error("Transient target pool disposed");
    const normalized = targetDescriptor(descriptor);
    const index = this.idle.findIndex((entry) => {
      // Exact normalized compatibility prevents format, mip, sample or usage hazards.
      return entry.key === normalized.key;
    });
    let entry: Entry;
    if (index >= 0) {
      entry = this.idle.splice(index, 1)[0]!;
      this.stats.idleBytes -= entry.bytes;
      this.stats.hits++;
    } else {
      const texture = this.textures.create(
        normalized.descriptor,
        "render-target",
      );
      try {
        entry = {
          key: normalized.key,
          texture,
          view: texture.createView(),
          bytes: textureMemory(normalized.descriptor).bytes,
          state: "active",
        };
      } catch (error) {
        this.textures.destroy(texture);
        throw error;
      }
      this.entries.add(entry);
      this.stats.misses++;
    }
    entry.state = "active";
    this.stats.activeBytes += entry.bytes;
    let released = false;
    return {
      texture: entry.texture,
      view: entry.view,
      release: () => {
        // A lease may be released repeatedly, but must never retire a later reuse of the same entry.
        if (released || this.disposed) return;
        released = true;
        this.retire(entry);
      },
    };
  }
  /** Move a released target through a completion quarantine before placing it in the idle LRU. */
  private retire(entry: Entry): void {
    entry.state = "retired";
    this.stats.activeBytes -= entry.bytes;
    this.stats.retiredBytes += entry.bytes;
    const operation = Promise.resolve()
      .then(() => {
        // Establish a cold fence without blocking ordinary rendering or assuming immediate completion.
        return this.completion();
      })
      .then(
        () => {
          // Completed submitted work cannot observe a later target reuse; bound retained idle memory.
          if (this.disposed) return;
          this.stats.retiredBytes -= entry.bytes;
          entry.state = "idle";
          this.idle.push(entry);
          this.stats.idleBytes += entry.bytes;
          this.trim();
        },
        () => {
          // Failed/lost-device completion cannot make an entry reusable.
          if (this.disposed) return;
          this.stats.retiredBytes -= entry.bytes;
          this.entries.delete(entry);
          this.textures.destroy(entry.texture);
        },
      )
      .finally(() => {
        // Drop settled fences so the pool itself does not accumulate history.
        this.pending.delete(operation);
      });
    this.pending.add(operation);
  }
  /** Evict oldest idle entries until both retention limits are satisfied. */
  trim(): void {
    while (
      this.idle.length > this.maxIdleTargets ||
      this.stats.idleBytes > this.maxIdleBytes
    ) {
      const entry = this.idle.shift()!;
      this.stats.idleBytes -= entry.bytes;
      this.entries.delete(entry);
      this.textures.destroy(entry.texture);
      this.stats.evictions++;
    }
  }
  /** Explicitly release completed idle cache memory without disturbing active or quarantined targets. */
  clearIdle(): void {
    for (const entry of this.idle) {
      this.entries.delete(entry);
      this.textures.destroy(entry.texture);
      this.stats.evictions++;
    }
    this.idle.length = 0;
    this.stats.idleBytes = 0;
  }
  /** Await only explicit maintenance/test boundaries; this is never called by frame encoding. */
  async settle(): Promise<void> {
    await Promise.all(this.pending);
  }
  /** Destroy active, retired and idle ownership once; late completion callbacks cannot resurrect entries. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries) this.textures.destroy(entry.texture);
    this.entries.clear();
    this.idle.length = 0;
    this.stats.activeBytes = this.stats.retiredBytes = this.stats.idleBytes = 0;
  }
}
