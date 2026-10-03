import { ComponentStore } from "./ComponentStore";
import { Quat } from "../../math/Quat";
export class TransformStore extends ComponentStore {
  readonly positionX: Float32Array;
  readonly positionY: Float32Array;
  readonly positionZ: Float32Array;
  readonly rotationX: Float32Array;
  readonly rotationY: Float32Array;
  readonly rotationZ: Float32Array;
  readonly rotationW: Float32Array;
  readonly scaleX: Float32Array;
  readonly scaleY: Float32Array;
  readonly scaleZ: Float32Array;
  readonly worldMatrices: Float32Array;
  readonly parent: Int32Array;
  readonly firstChild: Int32Array;
  readonly nextSibling: Int32Array;
  readonly previousSibling: Int32Array;
  readonly dirty: Uint8Array;
  readonly dirtyQueue: Uint32Array;
  dirtyCount = 0;
  readonly queued: Uint8Array;
  private readonly stack: Uint32Array;
  private readonly quaternion = Quat.create();
  constructor(capacity: number) {
    super(capacity);
    this.positionX = new Float32Array(capacity);
    this.positionY = new Float32Array(capacity);
    this.positionZ = new Float32Array(capacity);
    this.rotationX = new Float32Array(capacity);
    this.rotationY = new Float32Array(capacity);
    this.rotationZ = new Float32Array(capacity);
    this.rotationW = new Float32Array(capacity);
    this.scaleX = new Float32Array(capacity);
    this.scaleY = new Float32Array(capacity);
    this.scaleZ = new Float32Array(capacity);
    this.worldMatrices = new Float32Array(capacity * 16);
    this.parent = new Int32Array(capacity).fill(-1);
    this.firstChild = new Int32Array(capacity).fill(-1);
    this.nextSibling = new Int32Array(capacity).fill(-1);
    this.previousSibling = new Int32Array(capacity).fill(-1);
    this.dirty = new Uint8Array(capacity);
    this.dirtyQueue = new Uint32Array(capacity);
    this.stack = new Uint32Array(capacity);
    this.queued = new Uint8Array(capacity);
  }
  override add(entity: number): void {
    if (this.has[entity]) return;
    super.add(entity);
    this.positionX[entity] =
      this.positionY[entity] =
      this.positionZ[entity] =
        0;
    this.rotationX[entity] =
      this.rotationY[entity] =
      this.rotationZ[entity] =
        0;
    this.rotationW[entity] = 1;
    this.scaleX[entity] = this.scaleY[entity] = this.scaleZ[entity] = 1;
    this.markDirty(entity);
  }
  private require(entity: number): void {
    if (!this.has[entity]) throw new Error("Entity has no transform");
  }
  setPosition(entity: number, x: number, y: number, z: number): void {
    this.require(entity);
    this.positionX[entity] = x;
    this.positionY[entity] = y;
    this.positionZ[entity] = z;
    this.markDirty(entity);
  }
  setScale(entity: number, x: number, y: number, z: number): void {
    this.require(entity);
    this.scaleX[entity] = x;
    this.scaleY[entity] = y;
    this.scaleZ[entity] = z;
    this.markDirty(entity);
  }
  setRotation(
    entity: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.require(entity);
    this.quaternion[0] = x;
    this.quaternion[1] = y;
    this.quaternion[2] = z;
    this.quaternion[3] = w;
    Quat.normalize(this.quaternion, this.quaternion);
    this.rotationX[entity] = this.quaternion[0]!;
    this.rotationY[entity] = this.quaternion[1]!;
    this.rotationZ[entity] = this.quaternion[2]!;
    this.rotationW[entity] = this.quaternion[3]!;
    this.markDirty(entity);
  }
  /** Trusted animation path: the sampler/pose blend already normalized these f32 values.
   * Keep setRotation for arbitrary gameplay inputs. Both setters propagate dirty state. */
  setNormalizedRotation(
    entity: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.require(entity);
    this.rotationX[entity] = x;
    this.rotationY[entity] = y;
    this.rotationZ[entity] = z;
    this.rotationW[entity] = w;
    this.markDirty(entity);
  }
  setParent(entity: number, parent: number): void {
    this.require(entity);
    if (parent !== -1) this.require(parent);
    for (
      let ancestor = parent;
      ancestor !== -1;
      ancestor = this.parent[ancestor]!
    )
      if (ancestor === entity) throw new Error("Transform hierarchy cycle");
    if (this.parent[entity] === parent) return;
    this.unlink(entity);
    this.parent[entity] = parent;
    if (parent !== -1) {
      const first = this.firstChild[parent]!;
      this.nextSibling[entity] = first;
      if (first !== -1) this.previousSibling[first] = entity;
      this.firstChild[parent] = entity;
    }
    this.markDirty(entity);
  }
  private unlink(entity: number): void {
    const parent = this.parent[entity]!,
      previous = this.previousSibling[entity]!,
      next = this.nextSibling[entity]!;
    if (previous !== -1) this.nextSibling[previous] = next;
    else if (parent !== -1) this.firstChild[parent] = next;
    if (next !== -1) this.previousSibling[next] = previous;
    this.previousSibling[entity] = this.nextSibling[entity] = -1;
    this.parent[entity] = -1;
  }
  markDirty(entity: number): void {
    this.require(entity);
    let count = 1;
    this.stack[0] = entity;
    while (count) {
      const current = this.stack[--count]!;
      if (this.dirty[current]) continue;
      this.dirty[current] = 1;
      if (!this.queued[current]) {
        this.queued[current] = 1;
        this.dirtyQueue[this.dirtyCount++] = current;
      }
      for (
        let child = this.firstChild[current]!;
        child !== -1;
        child = this.nextSibling[child]!
      )
        this.stack[count++] = child;
    }
  }
  override remove(entity: number): void {
    if (!this.has[entity]) return;
    while (this.firstChild[entity] !== -1)
      this.setParent(this.firstChild[entity]!, -1);
    this.unlink(entity);
    super.remove(entity);
    this.dirty[entity] = 0;
  }
}
