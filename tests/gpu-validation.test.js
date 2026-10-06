import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import {
  launchValidationBrowser,
  validationBrowserOptions,
} from "../scripts/gpu/validation-browser.mjs";

beforeEach(() => {
  // Isolate browser instrumentation and profile overrides from other gates.
  vi.stubEnv("RENDERER_GPU_PROFILE", "native");
});
afterEach(() => {
  // Restore navigator and adapter observations after each simulated browser lifecycle.
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete globalThis.__gpuValidation;
});

/** Simulate a cold adapter request while preserving the production init-script path. */
async function adapterProbe(profile, info) {
  vi.stubEnv("RENDERER_GPU_PROFILE", profile);
  vi.stubGlobal("navigator", {
    gpu: {
      requestAdapter: async () => {
        // Return adapter metadata without creating real resources in a CPU test.
        return { info, features: new Set(["timestamp-query"]), limits: {} };
      },
    },
  });
  const close = vi.fn();
  const page = {
    setDefaultTimeout: vi.fn(),
    on: vi.fn(),
    addInitScript: async (initialize, profile) => {
      // Execute the same installer Chromium executes before page navigation.
      initialize(profile);
    },
    isClosed: () => {
      // Keep diagnostics readable until the fake browser is closed.
      return false;
    },
    evaluate: async (read) => {
      // Evaluate only the cold metadata collector against the simulated globals.
      return read();
    },
  };
  vi.spyOn(chromium, "launch").mockResolvedValue({
    newPage: async () => {
      // Supply a fresh adapter-instrumented page.
      return page;
    },
    close,
    version: () => {
      // Distinguish simulated metadata from actual GPU evidence.
      return "test-browser";
    },
  });
  const browser = await launchValidationBrowser();
  await browser.newPage();
  return { browser, close };
}

describe("verified GPU validation profiles", () => {
  // Backend claims must be supported by actual adapter metadata, including failure cleanup.
  it("accepts SwiftShader only in the software profile", async () => {
    // Software CI may not silently fall back to a hardware-dependent result.
    const { browser, close } = await adapterProbe("software", {
      description: "SwiftShader",
      isFallbackAdapter: true,
    });
    await expect(navigator.gpu.requestAdapter()).resolves.toBeDefined();
    await expect(browser.close()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
  it("accepts a native adapter in the hardware profile", async () => {
    // The dedicated-runner gate accepts confirmed native devices without requiring a specific vendor.
    const { browser, close } = await adapterProbe("hardware", {
      vendor: "native",
      architecture: "metal",
      isFallbackAdapter: false,
    });
    await expect(navigator.gpu.requestAdapter()).resolves.toBeDefined();
    await expect(browser.close()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
  it("rejects a fallback adapter for hardware and still closes the browser", async () => {
    // A completed scenario cannot hide an incompatible adapter selected during recovery.
    const { browser, close } = await adapterProbe("hardware", {
      description: "SwiftShader",
      isFallbackAdapter: true,
    });
    await expect(navigator.gpu.requestAdapter()).rejects.toThrow(
      "incompatible adapter",
    );
    await expect(browser.close()).rejects.toThrow("incompatible adapter");
    expect(close).toHaveBeenCalledOnce();
  });
  it("rejects hardware in the software profile and invalid configuration before launch", async () => {
    // Explicit software requests must remain reproducible independently of installed GPUs.
    const { browser } = await adapterProbe("software", {
      description: "Apple M4",
      isFallbackAdapter: false,
    });
    await expect(navigator.gpu.requestAdapter()).rejects.toThrow(
      "incompatible adapter",
    );
    await expect(browser.close()).rejects.toThrow("incompatible adapter");
    expect(() =>
      /** Reject invalid backend names before launching Chromium. */ validationBrowserOptions(
        { RENDERER_GPU_PROFILE: "unknown" },
      ),
    ).toThrow("Unknown GPU profile");
  });
});
