import { RuntimePrimitive } from "../assets/gltf/RuntimeAsset";
/** Shared immutable mesh deltas; absent POSITION/NORMAL/TANGENT streams mean zero. */
export class MorphTargetData {
  readonly vertexCount: number;
  readonly targetCount: number;
  readonly positionMin: Float32Array;
  readonly positionMax: Float32Array;
  constructor(
    readonly targets: RuntimePrimitive["targets"],
    vertexCount: number,
  ) {
    this.vertexCount = vertexCount;
    this.targetCount = targets.length;
    this.positionMin = new Float32Array(targets.length * 3);
    this.positionMax = new Float32Array(targets.length * 3);
    for (const target of targets)
      for (const [semantic, data] of Object.entries(target)) {
        if (
          !["POSITION", "NORMAL", "TANGENT"].includes(semantic) ||
          data.length !== vertexCount * 3
        )
          throw new Error("Invalid morph target stream");
        for (const value of data)
          if (!Number.isFinite(value)) throw new Error("Invalid morph delta");
      }
    for (let t = 0; t < targets.length; t++) {
      const position = targets[t]!.POSITION;
      if (!position) continue;
      for (let axis = 0; axis < 3; axis++) {
        let min = Infinity,
          max = -Infinity;
        for (let v = axis; v < position.length; v += 3) {
          min = Math.min(min, position[v]!);
          max = Math.max(max, position[v]!);
        }
        this.positionMin[t * 3 + axis] = min;
        this.positionMax[t * 3 + axis] = max;
      }
    }
  }
}
