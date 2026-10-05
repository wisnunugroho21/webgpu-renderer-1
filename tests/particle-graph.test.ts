import { expect, it } from "vitest";
import { RenderGraph } from "../src/rendering/graph/RenderGraph";
import { configureRenderGraph } from "../src/rendering/graph/configureRenderGraph";
it("accepts existing callback sets and composes optional particles before presentation", () => {
  // Preserve callers predating particle support and check the real compiled dependency schedule.
  const events: string[] = [];
  /** Nonparticipating GPU passes perform no work in this CPU dependency check. */
  const noop = () => {};
  const callbacks = {
    gpuFrustum: noop,
    shadows: noop,
    lightClusters: noop,
    depth: noop,
    geometryClusters: noop,
    color: () => {
      /* Record scene color production. */ events.push("color");
    },
    postProcessing: () => {
      /* Record the bloom/exposure input boundary. */ events.push("post");
    },
    toneMapping: () => {
      /* Record final presentation. */ events.push("present");
    },
    hiz: noop,
    hizDebug: noop,
    gpuOcclusion: noop,
    gpuCompaction: noop,
    gpuIndirect: noop,
    gpuLod: noop,
  };
  /** Create a graph with the renderer's externally uploaded snapshot resources. */
  function graph(): RenderGraph<GPUTextureView> {
    return new RenderGraph([
      "frame",
      "geometry",
      "materials",
      "instances",
      "lights",
      "deformation",
    ]);
  }
  const legacy = graph();
  configureRenderGraph(legacy, callbacks);
  legacy.execute({} as GPUCommandEncoder, {} as GPUTextureView);
  expect(events).toEqual(["color", "post", "present"]);
  events.length = 0;
  const withParticles = graph();
  configureRenderGraph(withParticles, {
    ...callbacks,
    particles: () => {
      /* Record particle composition on the scene-color version. */ events.push(
        "particles",
      );
    },
  });
  withParticles.execute({} as GPUCommandEncoder, {} as GPUTextureView);
  expect(events).toEqual(["color", "particles", "post", "present"]);
});
