/** Cold-path arena allocation. Stable offsets keep live GPU/CPU references valid.
 * Freed adjacent ranges coalesce; trailing space lowers the upload high-water mark. */
export class RangeAllocator {
  count = 0;
  private readonly live = new Map<number, number>();
  private readonly free: { offset: number; size: number }[] = [];
  constructor(readonly capacity: number) {}
  allocate(size: number): number {
    if (!Number.isSafeInteger(size) || size < 1)
      throw new Error("Invalid arena allocation");
    const index = this.free.findIndex((range) => range.size >= size);
    let offset: number;
    if (index >= 0) {
      const range = this.free[index]!;
      offset = range.offset;
      range.offset += size;
      range.size -= size;
      if (!range.size) this.free.splice(index, 1);
    } else {
      if (this.count + size > this.capacity)
        throw new Error("Arena capacity exceeded");
      offset = this.count;
      this.count += size;
    }
    this.live.set(offset, size);
    return offset;
  }
  release(offset: number): void {
    const size = this.live.get(offset);
    if (size === undefined) return;
    this.live.delete(offset);
    this.free.push({ offset, size });
    this.free.sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < this.free.length;) {
      const a = this.free[i - 1]!,
        b = this.free[i]!;
      if (a.offset + a.size === b.offset) {
        a.size += b.size;
        this.free.splice(i, 1);
      } else i++;
    }
    const tail = this.free.at(-1);
    if (tail && tail.offset + tail.size === this.count) {
      this.count = tail.offset;
      this.free.pop();
    }
  }
}
