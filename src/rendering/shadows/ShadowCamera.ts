import { Mat4 } from "../../math/Mat4";
import { Camera } from "../Camera";
import { RenderWorld } from "../RenderWorld";
/** Fits receiver slices in XY and all caster bounds in light-space Z. No vertex traversal. */
export class ShadowCamera {
  readonly matrix = Mat4.create();
  private readonly inverse = Mat4.create();
  private readonly view = Mat4.create();
  private readonly projection = Mat4.create();
  private readonly corners = new Float32Array(24);
  private readonly center = new Float32Array(3);
  private readonly eye = new Float32Array(3);
  private readonly up = new Float32Array(3);
  /** Fits a directional light projection to the requested camera slice using retained matrix scratch. */
  fit(
    camera: Camera,
    world: RenderWorld,
    light: number,
    near: number,
    far: number,
    resolution: number,
  ): void {
    Mat4.invert(this.inverse, camera.view);
    this.center.fill(0);
    let index = 0;
    for (let z = 0; z < 2; z++)
      for (let y = -1; y <= 1; y += 2)
        for (let x = -1; x <= 1; x += 2) {
          const depth = z ? far : near,
            px =
              (x * (camera.projectionType === "orthographic" ? 1 : depth)) /
              camera.projection[0]!,
            py =
              (y * (camera.projectionType === "orthographic" ? 1 : depth)) /
              camera.projection[5]!;
          for (let axis = 0; axis < 3; axis++) {
            const v =
              this.inverse[axis]! * px +
              this.inverse[4 + axis]! * py -
              this.inverse[8 + axis]! * depth +
              this.inverse[12 + axis]!;
            this.corners[index * 3 + axis] = v;
            this.center[axis]! += v / 8;
          }
          index++;
        }
    let radius = 0;
    for (let i = 0; i < 8; i++)
      radius = Math.max(
        radius,
        Math.hypot(
          this.corners[i * 3]! - this.center[0]!,
          this.corners[i * 3 + 1]! - this.center[1]!,
          this.corners[i * 3 + 2]! - this.center[2]!,
        ),
      );
    radius = Math.ceil(radius * 16) / 16;
    const o = light * 16;
    for (let axis = 0; axis < 3; axis++)
      this.eye[axis] =
        this.center[axis]! - world.lightData[o + 8 + axis]! * (radius + 10);
    this.up.fill(0);
    this.up[Math.abs(world.lightData[o + 9]!) > 0.95 ? 2 : 1] = 1;
    Mat4.lookAt(this.view, this.eye, this.center, this.up);
    // Stable texel alignment avoids crawling edges during small camera motion.
    const texel = (2 * radius) / resolution;
    this.view[12] = Math.round(this.view[12]! / texel) * texel;
    this.view[13] = Math.round(this.view[13]! / texel) * texel;
    let minZ = -2 * radius - 10,
      maxZ = -10;
    for (let i = 0; i < world.count; i++) {
      let lo = this.view[14]!,
        hi = lo;
      for (let axis = 0; axis < 3; axis++) {
        const a = this.view[axis * 4 + 2]! * world.boundsMin[i * 3 + axis]!,
          b = this.view[axis * 4 + 2]! * world.boundsMax[i * 3 + axis]!;
        lo += Math.min(a, b);
        hi += Math.max(a, b);
      }
      minZ = Math.min(minZ, lo);
      maxZ = Math.max(maxZ, hi);
    }
    // Move the light eye upstream when distant geometry would otherwise lie behind it.
    const shift = Math.max(0, maxZ + 1);
    this.view[14]! -= shift;
    minZ -= shift;
    maxZ -= shift;
    Mat4.orthographic(
      this.projection,
      -radius,
      radius,
      -radius,
      radius,
      Math.max(0.01, -maxZ - 0.5),
      -minZ + 0.5,
    );
    Mat4.multiply(this.matrix, this.projection, this.view);
  }
}
