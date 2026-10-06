import type { Renderer } from "../Renderer";
import type { TargetLease } from "../../gpu/TransientTargetPool";

/** Prepare persistent history targets/groups on resize; owner arrays retain partial acquisitions for teardown. */
export function prepareTemporalTargets(
  renderer: Renderer,
  scene: GPUTexture,
  depth: GPUTextureView,
  resolveLayout: GPUBindGroupLayout,
  settingsBuffer: GPUBuffer,
  targets: TargetLease[],
  groups: GPUBindGroup[],
): void {
  for (const format of [
    "rgba32float",
    "rgba16float",
    "rgba16float",
    "r32float",
    "rgba16float",
    "r32float",
  ] as const)
    targets.push(
      renderer.resources.targets.acquire({
        label: "Persistent temporal history",
        size: [scene.width, scene.height],
        format,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST,
      }),
    );
  const sceneView = scene.createView();
  for (let index = 0; index < 2; index++)
    groups.push(
      renderer.gpu.device.createBindGroup({
        layout: resolveLayout,
        entries: [
          sceneView,
          targets[1]!.view,
          targets[0]!.view,
          depth,
          targets[2 + index * 2]!.view,
          targets[3 + index * 2]!.view,
        ]
          .map((resource, binding): GPUBindGroupEntry => {
            // Each immutable group reads one history pair; the opposite pair receives this frame.
            return { binding, resource };
          })
          .concat([
            {
              binding: 6,
              resource: {
                buffer: settingsBuffer,
              },
            },
          ]),
      }),
    );
}
