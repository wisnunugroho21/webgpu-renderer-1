import { ComponentStore } from "./ComponentStore";
export interface Light {
  type: "directional" | "point" | "spot";
  castShadow?: boolean;
  color?: ArrayLike<number>;
  intensity?: number;
  range?: number;
  direction?: ArrayLike<number>;
  innerCone?: number;
  outerCone?: number;
}
export class LightStore extends ComponentStore {
  readonly type: Uint8Array;
  readonly castShadow: Uint8Array;
  readonly direction: Float32Array;
  readonly color: Float32Array;
  readonly intensity: Float32Array;
  readonly range: Float32Array;
  readonly innerCone: Float32Array;
  readonly outerCone: Float32Array;
  constructor(capacity: number) {
    super(capacity);
    this.type = new Uint8Array(capacity);
    this.castShadow = new Uint8Array(capacity);
    this.direction = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.intensity = new Float32Array(capacity);
    this.range = new Float32Array(capacity);
    this.innerCone = new Float32Array(capacity);
    this.outerCone = new Float32Array(capacity);
  }
  override add(entity: number): void {
    if (this.has[entity]) return;
    super.add(entity);
    this.direction[entity * 3] = this.direction[entity * 3 + 1] = 0;
    this.direction[entity * 3 + 2] = -1;
    this.color.fill(1, entity * 3, entity * 3 + 3);
    this.intensity[entity] = 1;
    this.range[entity] = 0;
    this.castShadow[entity] = 0;
    this.innerCone[entity] = 0;
    this.outerCone[entity] = Math.PI / 4;
  }
  set(entity: number, light: Light): void {
    const type =
        light.type === "directional"
          ? 0
          : light.type === "point"
            ? 1
            : light.type === "spot"
              ? 2
              : -1,
      color = light.color ?? [1, 1, 1],
      direction = light.direction ?? [0, 0, -1],
      intensity = light.intensity ?? 1,
      range = light.range ?? 0,
      inner = light.innerCone ?? 0,
      outer = light.outerCone ?? Math.PI / 4;
    if (
      type < 0 ||
      (light.castShadow === true && type !== 0) ||
      color.length !== 3 ||
      direction.length !== 3 ||
      !Number.isFinite(intensity) ||
      intensity < 0 ||
      !Number.isFinite(range) ||
      range < 0 ||
      !Number.isFinite(inner) ||
      !Number.isFinite(outer) ||
      inner < 0 ||
      outer < inner ||
      outer > Math.PI / 2
    )
      throw new Error("Invalid light");
    for (let i = 0; i < 3; i++)
      if (
        !Number.isFinite(color[i]) ||
        color[i]! < 0 ||
        !Number.isFinite(direction[i])
      )
        throw new Error("Invalid light color/direction");
    const length = Math.hypot(direction[0]!, direction[1]!, direction[2]!);
    if (!length) throw new Error("Zero light direction");
    this.add(entity);
    this.type[entity] = type;
    this.castShadow[entity] = light.castShadow ? 1 : 0;
    this.intensity[entity] = intensity;
    this.range[entity] = range;
    this.innerCone[entity] = inner;
    this.outerCone[entity] = outer;
    for (let i = 0; i < 3; i++) {
      this.color[entity * 3 + i] = color[i]!;
      this.direction[entity * 3 + i] = direction[i]! / length;
    }
  }
}
