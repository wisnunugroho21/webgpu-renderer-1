/** Cold asset metadata. Consecutive triangle ranges preserve winding, vertex IDs and order. */
export class MeshClusters {
  readonly count: number;
  readonly bounds: Float32Array;
  readonly firstIndex: Uint32Array;
  readonly indexCount: Uint32Array;
  /** Initializes consecutive triangle ranges and conservative per-cluster bounds; invalid input is rejected. */
  constructor(
    positions: Float32Array,
    indices: Uint32Array,
    trianglesPerCluster = 256,
  ) {
    if (
      !Number.isInteger(trianglesPerCluster) ||
      trianglesPerCluster < 1 ||
      positions.length % 3 ||
      !indices.length ||
      indices.length % 3
    )
      throw new Error("Invalid cluster geometry");
    this.count = Math.ceil(indices.length / (trianglesPerCluster * 3));
    this.bounds = new Float32Array(this.count * 8);
    this.firstIndex = new Uint32Array(this.count);
    this.indexCount = new Uint32Array(this.count);
    for (let c = 0; c < this.count; c++) {
      const start = c * trianglesPerCluster * 3,
        end = Math.min(indices.length, start + trianglesPerCluster * 3),
        o = c * 8;
      this.firstIndex[c] = start;
      this.indexCount[c] = end - start;
      this.bounds.fill(Infinity, o, o + 3);
      this.bounds.fill(-Infinity, o + 4, o + 7);
      for (let i = start; i < end; i++) {
        const vertex = indices[i]!;
        if (vertex >= positions.length / 3)
          throw new Error("Cluster index out of range");
        for (let a = 0; a < 3; a++) {
          const value = positions[vertex * 3 + a]!;
          if (!Number.isFinite(value))
            throw new Error("Invalid cluster position");
          this.bounds[o + a] = Math.min(this.bounds[o + a]!, value);
          this.bounds[o + 4 + a] = Math.max(this.bounds[o + 4 + a]!, value);
        }
      }
    }
  }
}
