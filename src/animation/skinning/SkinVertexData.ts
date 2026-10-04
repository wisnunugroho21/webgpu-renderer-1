import { RuntimePrimitive } from "../../assets/gltf/RuntimeAsset";
export interface Influences {
  readonly joints: Uint32Array;
  readonly weights: Float32Array;
}
/** Static influence streams; both sets normalize jointly for the shared eight-weight GPU path. */
export class SkinVertexData {
  /** Initializes validated four/eight-influence joint indices and weights. */
  private constructor(
    readonly primary: Influences,
    readonly secondary?: Influences,
  ) {}
  /** Decodes primary/secondary glTF skin attributes and validates jointly normalized influence weights. */
  static fromPrimitive(p: RuntimePrimitive): SkinVertexData | undefined {
    if (
      Object.keys(p.attributes).some(
        (key) =>
          /** Evaluates the Number(/^(?:JOINTS|WEIGHTS)_(\d+)$/.exec(key)?.[1] ?? 0) > 1 condition. */ Number(
            /^(?:JOINTS|WEIGHTS)_(\d+)$/.exec(key)?.[1] ?? 0,
          ) > 1,
      )
    )
      throw new Error("More than eight skin influences are unsupported");
    const count = p.attributes.POSITION!.length / 3;
    /** Copies one accessor component into packed influence storage using its declared stride and offset. */
    const read = (set: number): Influences | undefined => {
      const j = p.attributes[`JOINTS_${set}`],
        w = p.attributes[`WEIGHTS_${set}`];
      if (!j && !w) return;
      if (!j || !w || j.length !== count * 4 || w.length !== count * 4)
        throw new Error("Invalid skin influence stream");
      const joints = new Uint32Array(j.length),
        weights = w.slice();
      for (let i = 0; i < j.length; i++) {
        if (
          !Number.isInteger(j[i]) ||
          j[i]! < 0 ||
          j[i]! > 65535 ||
          !Number.isFinite(w[i]) ||
          w[i]! < 0
        )
          throw new Error("Invalid skin influence");
        joints[i] = j[i]!;
      }
      return { joints, weights };
    };
    const primary = read(0),
      secondary = read(1);
    if (!primary) {
      if (secondary) throw new Error("Secondary influences require JOINTS_0");
      return;
    }
    // Normalize all retained influences jointly once, after accessor normalization.
    for (let v = 0; v < count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++)
        sum +=
          primary.weights[v * 4 + k]! + (secondary?.weights[v * 4 + k] ?? 0);
      if (sum <= 0) throw new Error("Skin vertex has no weight");
      for (let k = 0; k < 4; k++) {
        primary.weights[v * 4 + k]! /= sum;
        if (secondary) secondary.weights[v * 4 + k]! /= sum;
      }
    }
    return new SkinVertexData(primary, secondary);
  }
  /** Rejects vertex influences addressing joints outside the attached skeleton palette. */
  validateJointCount(count: number): void {
    for (const set of [this.primary, this.secondary])
      if (set)
        for (const index of set.joints)
          if (index >= count) throw new Error("Skin joint index out of range");
  }
}
