/** Walk metadata only: typed-array contents are transferred, never enumerated or copied. */
export function transferableBuffers(value: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>(),
    seen = new Set<object>();
  /** Applies seen.has, seen.add, buffers.add to visit. */
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (item instanceof ArrayBuffer) {
      buffers.add(item);
      return;
    }
    if (ArrayBuffer.isView(item)) {
      if (item.buffer instanceof ArrayBuffer) buffers.add(item.buffer);
      return;
    }
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return Array.from(buffers);
}
