import { Camera } from "./Camera";
import { ClusteredLighting } from "./lighting/ClusteredLighting";
import { FRAME_WORDS } from "./layouts";

/** Persistent staging storage for shaders/frame.wgsl's 192-byte Frame struct. */
export class FrameUniforms {
  readonly data = new Float32Array(FRAME_WORDS);

  update(
    camera: Camera,
    lightCount: number,
    clusters: ClusteredLighting,
    clustered: boolean,
    width: number,
    height: number,
  ): void {
    const data = this.data;
    // Two column-major matrices surround the eye/light-count vec4.
    data.set(camera.viewProjection);
    data.set(camera.position, 16);
    data[19] = lightCount;
    data.set(camera.view, 20);
    data[36] = clusters.tilesX;
    data[37] = clusters.tilesY;
    data[38] = clusters.tileSize;
    data[39] = clusters.slices;
    // lighting.z packs bit 0 = clustered lights, bit 1 = orthographic projection.
    data[40] = camera.near;
    data[41] = camera.far;
    data[42] =
      (clustered ? 1 : 0) + (camera.projectionType === "orthographic" ? 2 : 0);
    data[43] = clusters.maxLights;
    data[44] = width;
    data[45] = height;
    data[46] = camera.projection[0]!;
    data[47] = camera.projection[5]!;
  }
}
