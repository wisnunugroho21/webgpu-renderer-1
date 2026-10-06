import { describe, expect, it, vi } from "vitest";
import { TemporalAntialiasing } from "../src/rendering/post/TemporalAntialiasing";
import { Renderer } from "../src/rendering/Renderer";

/** Provide individually valid pools whose combined previous-pose arena can exceed a device binding limit. */
function fixture(limit: number) {
  const renderer = {
    world: { capacity: 1, jointCapacity: 16, morphCapacity: 0 },
    gpu: {
      device: {
        limits: { maxStorageBufferBindingSize: limit, maxBufferSize: 2048 },
      },
    },
    hdr: { antialiasing: "none" },
    antialiasing: "taa",
    resources: { buffers: { create: vi.fn() } },
  };
  const taa = new TemporalAntialiasing(renderer as unknown as Renderer);
  return { renderer: { ...renderer, taa }, taa };
}

describe("optional temporal storage preflight", () => {
  // Combined arenas must fit a single binding even when each original pool fits separately.
  it("rejects an oversized combined pose before GPU allocation or activation", () => {
    // The original 1,024-byte joint pool fits; the 1,152-byte retained pose does not.
    const { renderer, taa } = fixture(1024);
    expect(() => {
      /* Exercise the actual enable path. */ taa.enabled = true;
    }).toThrow("1152 bytes");
    expect(taa.enabled).toBe(false);
    expect(renderer.resources.buffers.create).not.toHaveBeenCalled();
  });
  it("preserves the previous presentation mode on rejected configuration", () => {
    // Renderer validates before the HDR owner can allocate a new linear scene or change mode.
    const { renderer, taa } = fixture(1024);
    const setMode = Object.getOwnPropertyDescriptor(
      Renderer.prototype,
      "antialiasing",
    )!.set!;
    expect(() => {
      /* Apply the public renderer setter to the cold configuration. */ setMode.call(
        renderer,
        "taa",
      );
    }).toThrow("device binding/buffer limit");
    expect(renderer.hdr.antialiasing).toBe("none");
    expect(taa.enabled).toBe(false);
  });
  it("accepts fitting pools without creating optional resources", () => {
    // Preflight alone is suitable for setup-time checks and leaves ordinary rendering untouched.
    const { renderer, taa } = fixture(2048);
    expect(() => {
      /* Validate capacity without enabling TAA. */ taa.preflight();
    }).not.toThrow();
    expect(taa.enabled).toBe(false);
    expect(renderer.resources.buffers.create).not.toHaveBeenCalled();
  });
});
