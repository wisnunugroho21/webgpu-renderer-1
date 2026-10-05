/** Stable four-pass radix ordering for alpha centers; all scratch storage is allocated once. */
export class ParticleDepthSorter {
  private readonly scratch: Uint32Array;
  private readonly keys: Uint32Array;
  private readonly buckets = new Uint32Array(256);
  private readonly bits: Uint32Array;
  /** Alias existing f32 depths as bits and allocate fixed-capacity indices/keys. */
  constructor(depths: Float32Array) {
    this.bits = new Uint32Array(
      depths.buffer,
      depths.byteOffset,
      depths.length,
    );
    this.scratch = new Uint32Array(depths.length);
    this.keys = new Uint32Array(depths.length);
  }
  /** Stable far-to-near ordering of finite Float32 depths referenced by the used index prefix.
   * Flip sign-bit ordering into sortable unsigned keys, then complement for descending depth.
   * Four byte passes return results to the caller array; equal depths preserve incoming order. */
  sort(order: Uint32Array, count: number): void {
    if (count < 2) return;
    for (let i = 0; i < count; i++) {
      const index = order[i]!;
      let bits = this.bits[index]!;
      if (bits === 0x80000000) bits = 0; // Signed zero must retain the same tie order as positive zero.
      const ascending = bits & 0x80000000 ? ~bits : bits ^ 0x80000000;
      this.keys[index] = ~ascending >>> 0;
    }
    let source = order,
      target = this.scratch;
    for (let shift = 0; shift < 32; shift += 8) {
      this.buckets.fill(0);
      for (let i = 0; i < count; i++)
        this.buckets[(this.keys[source[i]!]! >>> shift) & 255]!++;
      let offset = 0;
      for (let bucket = 0; bucket < 256; bucket++) {
        const length = this.buckets[bucket]!;
        this.buckets[bucket] = offset;
        offset += length;
      }
      for (let i = 0; i < count; i++) {
        const index = source[i]!,
          bucket = (this.keys[index]! >>> shift) & 255;
        target[this.buckets[bucket]!] = index;
        this.buckets[bucket]!++;
      }
      const swap = source;
      source = target;
      target = swap;
    }
    // Four swaps place the final result back in the caller's order array; unused suffixes are untouched.
  }
}
