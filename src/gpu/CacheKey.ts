/** Stable descriptor keys preserve array order and identity of opaque GPU objects. */
export class CacheKey {
  private nextId = 1;
  private readonly ids = new WeakMap<object, number>();
  /** Serializes descriptor values with stable ordering and object identities for resource cache keys. */
  encode(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null || typeof value !== "object")
      return JSON.stringify(value);
    if (Array.isArray(value))
      return `[${value.map((v) => /** Delegates this operation to this.encode. */ this.encode(v)).join(",")}]`;
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      let id = this.ids.get(value);
      if (id === undefined) {
        id = this.nextId++;
        this.ids.set(value, id);
      }
      return `gpu:${id}`;
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter(
        (k) =>
          /** Evaluates the k !== "label" && object[k] !== undefined condition. */ k !==
            "label" && object[k] !== undefined,
      )
      .sort()
      .map(
        (k) =>
          /** Returns `${JSON.stringify(k)}:${this.encode(object[k])}`. */ `${JSON.stringify(k)}:${this.encode(object[k])}`,
      )
      .join(",")}}`;
  }
}
