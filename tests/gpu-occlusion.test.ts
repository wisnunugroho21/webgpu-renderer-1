import { describe, it, expect, vi } from "vitest";
import { GPUOcclusionCuller } from "../src/rendering/visibility/GPUOcclusionCuller";
import { GPUFrustumCuller } from "../src/rendering/visibility/GPUFrustumCuller";
import { Resources } from "../src/gpu/Resources";
describe("GPU occlusion lifecycle", () => {
  // Groups checks for GPU occlusion lifecycle.

  it("binds shared visibility and refreshes groups only for a changed pyramid", () => {
    // Verifies binds shared visibility and refreshes groups only for a changed pyramid.

    vi.stubGlobal("GPUShaderStage", { COMPUTE: 1 });
    const createBindGroup = vi.fn((d) => /** Returns d. */ d),
      getCompute = vi.fn((d) => /** Returns d. */ d),
      device = {
        /** Returns d. */
        createBindGroupLayout: (d: unknown) => d,
        /** Returns d. */
        createPipelineLayout: (d: unknown) => d,
        createBindGroup,
      } as unknown as GPUDevice,
      resources = {
        pipelines: { getCompute },
        shaders: {
          /** Returns an empty fixture handle for a controlled test dependency. */
          get: () => ({}),
        },
      } as unknown as Resources,
      frustum = {
        count: 128,
        objects: {},
        visibility: {},
        params: {},
      } as unknown as GPUFrustumCuller;
    const culler = new GPUOcclusionCuller(
        device,
        resources,
        [{} as GPUBuffer, {} as GPUBuffer, {} as GPUBuffer],
        frustum,
      ),
      texture = {
        /** Returns an empty fixture handle for a controlled test dependency. */
        createView: () => ({}),
      } as unknown as GPUTexture;
    culler.resize(texture);
    culler.resize(texture);
    expect(createBindGroup).toHaveBeenCalledTimes(3);
    const dispatchWorkgroups = vi.fn(),
      pass = {
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups,
        end: vi.fn(),
      },
      encoder = {
        beginComputePass: vi.fn(() => /** Returns pass. */ pass),
      } as unknown as GPUCommandEncoder;
    culler.encode(encoder, 0);
    expect(encoder.beginComputePass).not.toHaveBeenCalled();
    culler.enabled = true;
    culler.encode(encoder, 0);
    culler.encode(encoder, 1);
    expect(dispatchWorkgroups.mock.calls).toEqual([[2], [2]]);
    expect(getCompute).toHaveBeenCalledTimes(1);
    expect(createBindGroup.mock.calls[0]![0].entries[2].resource.buffer).toBe(
      frustum.visibility,
    );
    vi.unstubAllGlobals();
  });
});
