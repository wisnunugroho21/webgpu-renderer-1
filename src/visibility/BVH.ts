import { RenderWorld } from "../rendering/RenderWorld";
import { RenderFlags } from "../rendering/RenderFlags";
import { Frustum } from "../math/Frustum";
import { FrustumCuller } from "./FrustumCuller";
/** Flat static BVH; moving objects are always tested separately. Build off the frame path. */
export class BVH {
  readonly indices: Uint32Array;
  readonly dynamic: Uint32Array;
  readonly visible: Uint32Array;
  readonly min: Float32Array;
  readonly max: Float32Array;
  readonly left: Int32Array;
  readonly right: Int32Array;
  readonly first: Uint32Array;
  readonly size: Uint32Array;
  private readonly stack: Int32Array;
  private world!: RenderWorld;
  private sortAxis = 0;
  /** Orders static object indices along the current split axis with deterministic ties. */
  private readonly compare = (a: number, b: number): number =>
    this.world.boundsMin[a * 3 + this.sortAxis]! +
      this.world.boundsMax[a * 3 + this.sortAxis]! -
      this.world.boundsMin[b * 3 + this.sortAxis]! -
      this.world.boundsMax[b * 3 + this.sortAxis]! || a - b;
  staticCount = 0;
  dynamicCount = 0;
  nodeCount = 0;
  nodesTested = 0;
  objectsTested = 0;
  visibleCount = 0;
  /** Initializes a static-object bounding-volume hierarchy; invalid input is rejected. */
  constructor(
    readonly capacity: number,
    readonly leafSize = 8,
  ) {
    if (leafSize < 1 || !Number.isInteger(leafSize))
      throw new Error("Invalid BVH leaf size");
    this.indices = new Uint32Array(capacity);
    this.dynamic = new Uint32Array(capacity);
    this.visible = new Uint32Array(capacity);
    this.min = new Float32Array(capacity * 6);
    this.max = new Float32Array(capacity * 6);
    this.left = new Int32Array(capacity * 2);
    this.right = new Int32Array(capacity * 2);
    this.first = new Uint32Array(capacity * 2);
    this.size = new Uint32Array(capacity * 2);
    this.stack = new Int32Array(capacity * 2);
  }
  /** Rebuilds static hierarchy nodes from extracted bounds and retains dynamic objects for linear testing. */
  build(world: RenderWorld): void {
    if (world.count > this.capacity) throw new Error("BVH capacity exceeded");
    this.world = world;
    this.staticCount = this.dynamicCount = this.nodeCount = 0;
    for (let i = 0; i < world.count; i++)
      if (world.flags[i]! & RenderFlags.STATIC)
        this.indices[this.staticCount++] = i;
      else this.dynamic[this.dynamicCount++] = i;
    if (this.staticCount) this.buildNode(0, this.staticCount);
  }
  /** Recursively partitions one static range and stores its conservative node bounds. */
  private buildNode(first: number, size: number): number {
    const node = this.nodeCount++,
      bounds = node * 3;
    this.first[node] = first;
    this.size[node] = size;
    this.left[node] = this.right[node] = -1;
    for (let axis = 0; axis < 3; axis++) {
      this.min[bounds + axis] = Infinity;
      this.max[bounds + axis] = -Infinity;
    }
    for (let i = first; i < first + size; i++)
      for (let axis = 0; axis < 3; axis++) {
        const object = this.indices[i]!;
        this.min[bounds + axis] = Math.min(
          this.min[bounds + axis]!,
          this.world.boundsMin[object * 3 + axis]!,
        );
        this.max[bounds + axis] = Math.max(
          this.max[bounds + axis]!,
          this.world.boundsMax[object * 3 + axis]!,
        );
      }
    if (size <= this.leafSize) return node;
    this.sortAxis = 0;
    for (let axis = 1; axis < 3; axis++)
      if (
        this.max[bounds + axis]! - this.min[bounds + axis]! >
        this.max[bounds + this.sortAxis]! - this.min[bounds + this.sortAxis]!
      )
        this.sortAxis = axis;
    this.indices.subarray(first, first + size).sort(this.compare);
    const half = Math.floor(size / 2);
    this.left[node] = this.buildNode(first, half);
    this.right[node] = this.buildNode(first + half, size - half);
    return node;
  }
  /** Classifies a node against the camera planes as outside, intersecting or fully inside. */
  private classify(node: number, frustum: Frustum): number {
    let inside = true;
    const planes = frustum.planes;
    for (let p = 0; p < 24; p += 4) {
      let positive = planes[p + 3]!,
        negative = positive;
      for (let axis = 0; axis < 3; axis++) {
        const normal = planes[p + axis]!,
          lo = this.min[node * 3 + axis]!,
          hi = this.max[node * 3 + axis]!;
        positive += normal * (normal >= 0 ? hi : lo);
        negative += normal * (normal >= 0 ? lo : hi);
      }
      if (positive < -1e-5) return -1;
      if (negative < 1e-5) inside = false;
    }
    return inside ? 1 : 0;
  }
  /** Traverses static nodes and tests dynamic objects into the retained visible-index array. */
  cull(world: RenderWorld, frustum: Frustum, tester: FrustumCuller): number {
    this.nodesTested = this.objectsTested = this.visibleCount = 0;
    let pending = 0;
    if (this.staticCount) this.stack[pending++] = 0;
    while (pending) {
      const node = this.stack[--pending]!,
        classification = this.classify(node, frustum);
      this.nodesTested++;
      if (classification < 0) continue;
      if (classification === 1) {
        for (
          let i = this.first[node]!;
          i < this.first[node]! + this.size[node]!;
          i++
        )
          this.visible[this.visibleCount++] = this.indices[i]!;
        continue;
      }
      if (this.left[node] !== -1) {
        this.stack[pending++] = this.right[node]!;
        this.stack[pending++] = this.left[node]!;
        continue;
      }
      for (
        let i = this.first[node]!;
        i < this.first[node]! + this.size[node]!;
        i++
      ) {
        const object = this.indices[i]!;
        this.objectsTested++;
        if (tester.intersects(world, object, frustum))
          this.visible[this.visibleCount++] = object;
      }
    }
    for (let i = 0; i < this.dynamicCount; i++) {
      const object = this.dynamic[i]!;
      this.objectsTested++;
      if (tester.intersects(world, object, frustum))
        this.visible[this.visibleCount++] = object;
    }
    return this.visibleCount;
  }
}
