import type { RenderWorld } from "../RenderWorld";
import type { Camera } from "../Camera";

export interface ShadowTargetOptions {
  resolution?: number;
  layers?: number;
}
export interface ShadowBudgetOptions {
  maxLayers?: number;
  maxTexels?: number;
  minResolution?: number;
}
/** Normalize cold target dimensions before GPU construction; memory is exactly resolution² × layers × four. */
export function shadowTargetOptions(
  options: ShadowTargetOptions = {},
): Required<ShadowTargetOptions> {
  const resolution = options.resolution ?? 1024,
    layers = options.layers ?? 16;
  if (
    !Number.isInteger(resolution) ||
    resolution < 128 ||
    resolution > 2048 ||
    resolution & (resolution - 1)
  )
    throw new Error(
      "Shadow resolution must be a power of two from 128 to 2048",
    );
  if (!Number.isInteger(layers) || layers < 1 || layers > 16)
    throw new Error("Shadow target layers must be 1–16");
  return Object.freeze({ resolution, layers });
}

/** Fixed scratch selects whole lights and power-of-two viewport sizes without GPU resources/readback. */
export class ShadowBudget {
  enabled = false;
  readonly resolutions: Uint16Array;
  readonly scores: Float64Array;
  private readonly order: Uint32Array;
  private readonly previous: Uint16Array;
  private readonly entities: Uint32Array;
  private settings: Required<ShadowBudgetOptions>;
  selectedLights = 0;
  rejectedLights = 0;
  selectedLayers = 0;
  selectedTexels = 0;
  /** Reserve planning tables once for the render snapshot's fixed light capacity. */
  constructor(
    capacity: number,
    readonly resolution: number,
    readonly layers: number,
  ) {
    this.resolutions = new Uint16Array(capacity);
    this.scores = new Float64Array(capacity);
    this.order = new Uint32Array(capacity);
    this.previous = new Uint16Array(capacity);
    this.entities = new Uint32Array(capacity).fill(0xffffffff);
    this.settings = Object.freeze({
      maxLayers: layers,
      maxTexels: resolution * resolution * layers,
      minResolution: 128,
    });
  }
  /** Expose an immutable configuration snapshot for inspection and device recovery. */
  get options(): Readonly<Required<ShadowBudgetOptions>> {
    return this.settings;
  }
  /** Validate a complete budget transaction; omitted fields retain the current budget. */
  configure(options: ShadowBudgetOptions): void {
    const next = { ...this.settings, ...options };
    if (
      !Number.isInteger(next.maxLayers) ||
      next.maxLayers < 0 ||
      next.maxLayers > this.layers
    )
      throw new Error("Invalid shadow layer budget");
    if (
      !Number.isSafeInteger(next.maxTexels) ||
      next.maxTexels < 0 ||
      next.maxTexels > this.layers * this.resolution * this.resolution
    )
      throw new Error("Invalid shadow texel budget");
    if (
      !Number.isInteger(next.minResolution) ||
      next.minResolution < 128 ||
      next.minResolution > this.resolution ||
      next.minResolution & (next.minResolution - 1)
    )
      throw new Error("Invalid minimum shadow resolution");
    this.settings = Object.freeze(next);
  }
  /** Sort importance descending with source rank ties; a retained allocation gets modest hysteresis. */
  private readonly compare = (a: number, b: number): number =>
    this.scores[b]! - this.scores[a]! || a - b;
  /** Select all faces/cascades atomically; distant local lights receive smaller retained-target viewports. */
  select(
    world: RenderWorld,
    camera: Camera,
    cascades: number,
    distance: number,
  ): void {
    this.selectedLights =
      this.rejectedLights =
      this.selectedLayers =
      this.selectedTexels =
        0;
    this.resolutions.fill(0);
    let candidates = 0;
    for (let light = 0; light < world.lightCount; light++) {
      const o = light * 16,
        type = world.lightData[o + 11]!;
      if (
        !world.lightShadow[light] ||
        (!type && Math.min(camera.far, distance) <= camera.near)
      )
        continue;
      const range = world.lightData[o + 3] || distance;
      const separation = Math.hypot(
        world.lightData[o]! - camera.position[0]!,
        world.lightData[o + 1]! - camera.position[1]!,
        world.lightData[o + 2]! - camera.position[2]!,
      );
      const coverage = type
        ? Math.min(1, range / Math.max(range, separation))
        : 1;
      const energy =
        Math.max(
          world.lightData[o + 4]!,
          world.lightData[o + 5]!,
          world.lightData[o + 6]!,
        ) * world.lightData[o + 7]!;
      const retained =
        this.entities[light] === world.lightEntity[light] &&
        this.previous[light] !== 0;
      this.scores[light] =
        (energy + 0.000001) * coverage * coverage * (retained ? 1.15 : 1);
      this.order[candidates++] = light;
    }
    if (this.enabled) this.order.subarray(0, candidates).sort(this.compare);
    let directional = 0;
    for (let rank = 0; rank < candidates; rank++) {
      const light = this.order[rank]!,
        o = light * 16,
        type = world.lightData[o + 11]!,
        count = !type ? cascades : type === 1 ? 6 : 1;
      let resolution = this.resolution;
      if (this.enabled) {
        const separation = Math.hypot(
          world.lightData[o]! - camera.position[0]!,
          world.lightData[o + 1]! - camera.position[1]!,
          world.lightData[o + 2]! - camera.position[2]!,
        );
        const range = world.lightData[o + 3] || distance;
        while (
          type &&
          resolution > this.settings.minResolution &&
          separation > ((range * this.resolution) / resolution) * 2
        )
          resolution /= 2;
        while (
          resolution > this.settings.minResolution &&
          this.selectedTexels + count * resolution * resolution >
            this.settings.maxTexels
        )
          resolution /= 2;
        if (
          this.selectedLayers + count > this.settings.maxLayers ||
          this.selectedTexels + count * resolution * resolution >
            this.settings.maxTexels ||
          (!type && directional === 4)
        ) {
          this.rejectedLights++;
          continue;
        }
      }
      this.resolutions[light] = resolution;
      this.selectedLights++;
      this.selectedLayers += count;
      this.selectedTexels += count * resolution * resolution;
      if (!type) directional++;
    }
    this.previous.set(this.resolutions);
    this.entities.set(world.lightEntity);
  }
}
