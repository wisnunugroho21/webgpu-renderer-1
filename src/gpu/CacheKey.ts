/** Stable descriptor keys preserve array order and identity of opaque GPU objects. */
export class CacheKey {
  private nextId = 1;
  private readonly ids = new WeakMap<object, number>();
  encode(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null || typeof value !== "object")
      return JSON.stringify(value);
    if (Array.isArray(value))
      return `[${value.map((v) => this.encode(v)).join(",")}]`;
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
      .filter((k) => k !== "label" && object[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${this.encode(object[k])}`)
      .join(",")}}`;
  }
}
