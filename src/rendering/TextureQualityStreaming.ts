import type { RuntimeAsset } from "../assets/gltf/RuntimeAsset";
import type { StreamBudget, StreamMemory } from "../assets/Streaming";
import type { Camera } from "./Camera";
import type { RenderWorld } from "./RenderWorld";
import type { RenderQueue } from "./RenderQueue";

export interface TextureQualityTier {
  key: string;
  /** Minimum projected object diameter in rendered pixels; ascending across tiers. */
  minPixels: number;
  /** Additional peak payload, including every mip and retained recovery source. */
  estimate: StreamMemory;
  load: () => Promise<RuntimeAsset>;
}
export interface TextureQualityHost {
  qualityGeneration(material: number): number;
  replaceMaterial(
    material: number,
    key: string,
    load: () => Promise<RuntimeAsset>,
    request: { priority: number; estimate: StreamMemory },
  ): Promise<boolean>;
  releaseMaterial(material: number): void;
  trimBudget(): Promise<number>;
  qualityMemory(): {
    memory: StreamMemory;
    reserved: StreamMemory;
    budget?: StreamBudget;
  };
}
interface Profile {
  tiers: readonly TextureQualityTier[];
  current: number;
  desired: number;
  generation: number;
  identity: number;
  pending: boolean;
  failures: number;
  retryFrame: number;
  lastError?: unknown;
}
/** Author-defined quality assets keep compression/maps intact; hot observation only queues cold async maintenance. */
export class TextureQualityStreaming {
  enabled = false;
  private interval = 30;
  /** Return the number of frames between projected-demand observations. */
  get intervalFrames(): number {
    return this.interval;
  }
  /** Validate observation cadence before replacing the active quality policy. */
  set intervalFrames(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 600)
      throw new Error("Invalid texture-quality interval");
    this.interval = value;
  }
  failures = 0;
  transitions = 0;
  private readonly pixels: Float32Array;
  private readonly profiles = new Map<number, Profile>();
  private lastFrame = -Infinity;
  private queued = false;
  private suspended = false;
  private disposed = false;
  private running: Promise<unknown> = Promise.resolve();
  /** Reserve per-material projection scratch once; the host retains all GPU ownership. */
  constructor(
    private readonly host: TextureQualityHost,
    capacity: number,
  ) {
    this.pixels = new Float32Array(capacity);
  }
  /** Validate/copy ordered authored tiers; tier zero is the already-resident material fallback. */
  register(material: number, tiers: readonly TextureQualityTier[]): void {
    if (
      this.disposed ||
      !Number.isInteger(material) ||
      material < 0 ||
      material >= this.pixels.length ||
      !this.host.qualityGeneration(material) ||
      this.profiles.has(material)
    )
      throw new Error("Invalid texture-quality material registration");
    if (!tiers.length || tiers.length > 8)
      throw new Error("Texture quality requires one to eight tiers");
    let previous = 0;
    const copied = tiers.map((tier) => {
      // Copy authored cold configuration so later caller mutation cannot change admission estimates.
      if (
        !tier.key ||
        typeof tier.load !== "function" ||
        !Number.isFinite(tier.minPixels) ||
        tier.minPixels <= previous ||
        !Number.isSafeInteger(tier.estimate.gpuBytes) ||
        tier.estimate.gpuBytes < 0 ||
        !Number.isSafeInteger(tier.estimate.recoveryBytes) ||
        tier.estimate.recoveryBytes < 0
      )
        throw new Error("Invalid texture-quality tier");
      previous = tier.minPixels;
      return Object.freeze({
        ...tier,
        estimate: Object.freeze({ ...tier.estimate }),
      });
    });
    this.profiles.set(material, {
      tiers: Object.freeze(copied),
      current: 0,
      desired: 0,
      generation: 0,
      identity: this.host.qualityGeneration(material),
      pending: false,
      failures: 0,
      retryFrame: 0,
    });
  }
  /** Stop managing one material and restore its resident fallback through normal streaming ownership. */
  unregister(material: number): void {
    const profile = this.profiles.get(material);
    if (!profile) return;
    profile.generation++;
    this.profiles.delete(material);
    this.host.releaseMaterial(material);
  }
  /** Return cold diagnostics without exposing mutable controller configuration. */
  status(material: number) {
    const p = this.profiles.get(material);
    return p
      ? {
          currentTier: p.current,
          desiredTier: p.desired,
          pending: p.pending,
          lastError: p.lastError,
          pixels: this.pixels[material],
        }
      : undefined;
  }
  /** Observe conservative object diameter without loading, GPU construction, waits or memory snapshots. */
  update(
    world: RenderWorld,
    queue: RenderQueue,
    camera: Camera,
    height: number,
    frame: number,
  ): void {
    if (
      !this.enabled ||
      this.suspended ||
      this.disposed ||
      !this.profiles.size ||
      frame - this.lastFrame < this.intervalFrames
    )
      return;
    if (!Number.isInteger(this.intervalFrames) || this.intervalFrames < 1)
      throw new Error("Invalid texture-quality interval");
    this.lastFrame = frame;
    this.pixels.fill(0);
    const view = camera.view,
      projection = camera.projection;
    for (let rank = 0; rank < queue.count; rank++) {
      const object = queue.order[rank]!,
        material = world.materialId[object]!;
      if (!this.profiles.has(material)) continue;
      const o = object * 4,
        x = world.sphere[o]!,
        y = world.sphere[o + 1]!,
        z = world.sphere[o + 2]!,
        radius = world.sphere[o + 3]!;
      const depth = -(view[2]! * x + view[6]! * y + view[10]! * z + view[14]!);
      if (depth + radius < camera.near || depth - radius > camera.far) continue;
      const vx = view[0]! * x + view[4]! * y + view[8]! * z + view[12]!,
        vy = view[1]! * x + view[5]! * y + view[9]! * z + view[13]!;
      if (camera.projectionType === "orthographic") {
        if (
          Math.abs(vx) > 1 / projection[0]! + radius ||
          Math.abs(vy) > 1 / projection[5]! + radius
        )
          continue;
      } else if (
        Math.abs(vx) * projection[0]! >
          depth + radius * Math.hypot(projection[0]!, 1) ||
        Math.abs(vy) * projection[5]! >
          depth + radius * Math.hypot(projection[5]!, 1)
      )
        continue;
      const diameter =
        (radius * height * projection[5]!) /
        (camera.projectionType === "orthographic"
          ? 1
          : Math.max(camera.near, depth - radius));
      this.pixels[material] = Math.max(
        this.pixels[material]!,
        Math.min(16777216, diameter),
      );
    }
    for (const [material, p] of this.profiles) {
      if (p.identity !== this.host.qualityGeneration(material)) {
        p.desired = 0;
        p.generation++;
        continue;
      }
      let desired = 0;
      for (let tier = 0; tier < p.tiers.length; tier++) {
        const threshold =
          p.tiers[tier]!.minPixels * (tier + 1 > p.current ? 1.15 : 0.85);
        if (this.pixels[material]! >= threshold) desired = tier + 1;
      }
      if (p.desired !== desired) {
        p.desired = desired;
        p.generation++;
        p.retryFrame = 0;
      }
    }
    if (!this.queued) {
      this.queued = true;
      queueMicrotask(this.maintain);
    }
  }
  /** Start queued maintenance after synchronous frame submission; retirement fences remain outside encoding. */
  private readonly maintain = (): void => {
    this.queued = false;
    if (!this.enabled || this.suspended || this.disposed) return;
    const jobs: Promise<void>[] = [];
    for (const [material, profile] of this.profiles)
      if (profile.identity !== this.host.qualityGeneration(material))
        this.unregister(material);
    const status = this.host.qualityMemory(),
      budget = status.budget;
    const pressure =
      budget &&
      (status.memory.gpuBytes + status.reserved.gpuBytes > budget.maxGPUBytes ||
        status.memory.recoveryBytes + status.reserved.recoveryBytes >
          budget.maxRecoveryBytes);
    for (const [material, profile] of this.profiles)
      if (
        !profile.pending &&
        this.lastFrame >= profile.retryFrame &&
        (profile.current !== profile.desired || pressure)
      )
        jobs.push(this.transition(material, profile));
    this.running = Promise.allSettled([this.running, ...jobs]);
  };
  /** Retain the current material through upgrades; use its resident fallback when budget pressure needs eviction. */
  private async transition(material: number, p: Profile): Promise<void> {
    if (p.current === p.desired && !p.current) return;
    p.pending = true;
    const generation = p.generation;
    try {
      let desired = p.desired;
      let status = this.host.qualityMemory();
      const budget = status.budget;
      let pressure =
        budget &&
        (status.memory.gpuBytes + status.reserved.gpuBytes >
          budget.maxGPUBytes ||
          status.memory.recoveryBytes + status.reserved.recoveryBytes >
            budget.maxRecoveryBytes);
      if (pressure) {
        await this.host.trimBudget();
        status = this.host.qualityMemory();
        pressure =
          budget &&
          (status.memory.gpuBytes + status.reserved.gpuBytes >
            budget.maxGPUBytes ||
            status.memory.recoveryBytes + status.reserved.recoveryBytes >
              budget.maxRecoveryBytes);
      }
      if (p.current === desired && !pressure) return;
      if (pressure && p.current) {
        this.host.releaseMaterial(material);
        p.current = 0;
        this.transitions++;
        await this.host.trimBudget();
        status = this.host.qualityMemory();
      }
      if (budget)
        while (desired > 0) {
          const estimate = p.tiers[desired - 1]!.estimate;
          if (
            status.memory.gpuBytes +
              status.reserved.gpuBytes +
              estimate.gpuBytes <=
              budget.maxGPUBytes &&
            status.memory.recoveryBytes +
              status.reserved.recoveryBytes +
              estimate.recoveryBytes <=
              budget.maxRecoveryBytes
          )
            break;
          desired--;
        }
      if (desired <= p.current && p.desired > p.current && !pressure) return;
      if (desired === p.current) return;
      if (desired === 0) {
        this.host.releaseMaterial(material);
        p.current = 0;
        this.transitions++;
        await this.host.trimBudget();
        return;
      }
      const tier = p.tiers[desired - 1]!;
      const published = await this.host.replaceMaterial(
        material,
        tier.key,
        tier.load,
        { priority: this.pixels[material]!, estimate: tier.estimate },
      );
      if (published && this.profiles.get(material) === p) {
        p.current = desired;
        p.lastError = undefined;
        p.failures = 0;
        p.retryFrame = 0;
        this.transitions++;
      }
      if (
        generation !== p.generation &&
        this.profiles.get(material) === p &&
        !this.suspended &&
        !this.disposed
      ) {
        // The next observed frame retries updated demand rather than racing another publication.
        this.lastFrame = -Infinity;
      }
    } catch (error) {
      p.lastError = error;
      this.failures++;
      p.failures++;
      p.retryFrame =
        this.lastFrame + Math.min(600, 30 * 2 ** Math.min(4, p.failures - 1));
    } finally {
      p.pending = false;
    }
  }
  /** Wait only at explicit maintenance/recovery boundaries, including already queued microtasks. */
  async wait(): Promise<void> {
    await Promise.resolve();
    await this.running;
  }
  /** Pause new publication and drain current quality work before changing device owners. */
  async suspend(): Promise<void> {
    this.suspended = true;
    await this.wait();
  }
  /** Resume retained authored profiles against the recovered host. */
  resume(): void {
    if (!this.disposed) {
      this.suspended = false;
      this.lastFrame = -Infinity;
    }
  }
  /** Cancel future publication and return every managed slot to its resident fallback. */
  dispose(): void {
    this.disposed = this.suspended = true;
    for (const material of this.profiles.keys()) this.unregister(material);
  }
}
