import { afterEach, expect, it, vi } from "vitest";
import { Application } from "../src/app/Application";
import { GPUContext } from "../src/gpu/GPUContext";
import { Renderer } from "../src/rendering/Renderer";
import * as recoveryResources from "../src/app/rebuildDeviceResources";

afterEach(() => {
  // Applies vi.restoreAllMocks, vi.unstubAllGlobals to the current callback state.

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
/** Builds controlled test dependencies and reusable state for application-recovery. */
function fixture() {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const app = new Application(
    {} as HTMLCanvasElement,
    {} as HTMLOutputElement,
    8,
  );
  const previous = {
    dispose: vi.fn(),
    streaming: {
      quiesce: vi.fn(async () => {
        /* Simulate a drained old owner. */
      }),
    },
  } as unknown as Renderer;
  const gpu = { dispose: vi.fn(), lost: false } as unknown as GPUContext;
  app.renderer = previous;
  app.gpu = gpu;
  const replacement = {
    renderer: {
      dispose: vi.fn(),
      restoreStreaming: vi.fn(),
      streaming: {
        quiesce: vi.fn(async () => {
          /* Simulate a drained replacement owner. */
        }),
      },
    } as unknown as Renderer,
    gpu: { dispose: vi.fn(), lost: false } as unknown as GPUContext,
    textureRemap: new Map<GPUBindGroup[], GPUBindGroup[]>(),
  };
  return { app, previous, gpu, replacement };
}
it("disposal between preparation and publication rejects recovery and cleans both owners", async () => {
  // Verifies disposal between preparation and publication rejects recovery and cleans both owners.

  const { app, previous, gpu, replacement } = fixture();
  let resolve!: (value: typeof replacement) => void;
  const prepared = new Promise<typeof replacement>((done) => {
    // Verifies disposal between preparation and publication rejects recovery and cleans both owners.

    resolve = done;
  });
  vi.spyOn(recoveryResources, "rebuildDeviceResources").mockReturnValue(
    prepared,
  );
  const recovery = app.recoverDevice(false);
  expect(app.recoverDevice(false)).toBe(recovery);
  const rejection = expect(recovery).rejects.toThrow(
    "Device unavailable during recovery",
  );
  // Resolve preparation, then dispose before the await continuation can publish it.
  resolve(replacement);
  const disposal = app.dispose();
  await Promise.all([rejection, disposal]);
  expect(app.renderer).toBe(previous);
  expect(app.gpu).toBe(gpu);
  expect(app.deviceState).toBe("disposed");
  expect(replacement.renderer.restoreStreaming).not.toHaveBeenCalled();
  expect(replacement.renderer.dispose).toHaveBeenCalledOnce();
  expect(replacement.gpu.dispose).toHaveBeenCalledOnce();
  expect(previous.dispose).toHaveBeenCalledOnce();
  expect(gpu.dispose).toHaveBeenCalledOnce();
});
it("failed publication retains original owners and releases the staged replacement", async () => {
  // Verifies failed publication retains original owners and releases the staged replacement.

  const { app, previous, gpu, replacement } = fixture();
  vi.spyOn(recoveryResources, "rebuildDeviceResources").mockResolvedValue(
    replacement,
  );
  vi.mocked(replacement.renderer.restoreStreaming).mockImplementation(() => {
    // Rejects invalid input for the current operation.

    throw new Error("Rebind failed");
  });
  await expect(app.recoverDevice(false)).rejects.toThrow("Rebind failed");
  expect(app.renderer).toBe(previous);
  expect(app.gpu).toBe(gpu);
  expect(app.deviceState).toBe("failed");
  expect(replacement.renderer.dispose).toHaveBeenCalledOnce();
  expect(replacement.gpu.dispose).toHaveBeenCalledOnce();
  expect(previous.dispose).not.toHaveBeenCalled();
  await app.dispose();
});
