import { describe, expect, it } from "vitest";
import { canvasSize } from "../src/gpu/GPUContext";

describe("canvas sizing", () => {
  it("uses physical pixels for high DPI displays", () => {
    expect(canvasSize(800, 600, 2, 8192)).toEqual([1600, 1200]);
  });
  it("keeps zero-size canvases valid", () => {
    expect(canvasSize(0, 0, 2, 8192)).toEqual([1, 1]);
  });
  it("preserves aspect ratio when the device dimension limit is exceeded", () => {
    expect(canvasSize(10000, 5000, 2, 8192)).toEqual([8192, 4096]);
  });
});
