import { RuntimeAsset } from "../../assets/gltf/RuntimeAsset";
/** Static bind data uses glTF node indices; it is shared by all instances of a skin. */
export class SkeletonAsset {
  readonly joints: Uint32Array;
  readonly inverseBindMatrices: Float32Array;
  readonly parents: Int32Array;
  readonly jointCount: number;
  readonly bindViews: readonly Float32Array[];
  readonly skeleton: number;
  constructor(
    skin: RuntimeAsset["skins"][number],
    nodes: RuntimeAsset["nodes"],
  ) {
    this.joints = skin.joints;
    this.inverseBindMatrices = skin.inverseBindMatrices;
    this.jointCount = skin.joints.length;
    this.skeleton = skin.skeleton;
    if (
      !this.jointCount ||
      this.inverseBindMatrices.length !== this.jointCount * 16 ||
      new Set(this.joints).size !== this.jointCount
    )
      throw new Error("Invalid skeleton bind data");
    for (const v of this.inverseBindMatrices)
      if (!Number.isFinite(v)) throw new Error("Invalid inverse bind matrix");
    const parent = new Int32Array(nodes.length).fill(-1),
      indices = new Int32Array(nodes.length).fill(-1);
    nodes.forEach((node, i) => {
      for (const child of node.children) {
        if (child >= nodes.length || parent[child] !== -1)
          throw new Error("Invalid skeleton hierarchy");
        parent[child] = i;
      }
    });
    const visited = new Uint8Array(nodes.length),
      stack = new Uint32Array(nodes.length);
    for (let node = 0; node < nodes.length; node++) {
      let p = node,
        count = 0;
      while (p !== -1 && visited[p] === 0) {
        visited[p] = 1;
        stack[count++] = p;
        p = parent[p]!;
      }
      if (p !== -1 && visited[p] === 1)
        throw new Error("Skeleton hierarchy cycle");
      while (count) visited[stack[--count]!] = 2;
    }
    this.joints.forEach((node, i) => {
      if (node >= nodes.length) throw new Error("Unknown skeleton joint");
      indices[node] = i;
    });
    if (this.skeleton >= nodes.length || this.skeleton < -1)
      throw new Error("Unknown skeleton root");
    this.bindViews = Array.from({ length: this.jointCount }, (_, i) =>
      this.inverseBindMatrices.subarray(i * 16, i * 16 + 16),
    );
    this.parents = new Int32Array(this.jointCount).fill(-1);
    this.joints.forEach((node, i) => {
      let p = parent[node]!,
        steps = 0;
      while (p !== -1) {
        if (++steps > nodes.length) throw new Error("Skeleton hierarchy cycle");
        if (indices[p] !== -1) {
          this.parents[i] = indices[p]!;
          break;
        }
        p = parent[p]!;
      }
    });
  }
}
