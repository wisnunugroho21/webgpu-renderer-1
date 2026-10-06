import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";

/** Validate explicit backend selection before launching a potentially expensive gate. */
export function validationBrowserOptions(env = process.env) {
  const profile = env.RENDERER_GPU_PROFILE ?? "native";
  if (!["native", "software", "hardware"].includes(profile))
    throw new Error(`Unknown GPU profile: ${profile}`);
  const channel = env.RENDERER_BROWSER_CHANNEL ?? "chrome";
  return {
    profile,
    options: {
      headless: true,
      // The bundled Chromium channel uses full-browser headless presentation, matching installed Chrome.
      channel,
      args:
        profile === "software"
          ? [
              "--enable-unsafe-webgpu",
              "--use-webgpu-adapter=swiftshader",
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
            ]
          : profile === "hardware"
            ? [
                "--enable-gpu",
                "--enable-unsafe-webgpu",
                ...(process.platform === "linux"
                  ? [
                      "--use-angle=vulkan",
                      "--enable-features=Vulkan,VulkanFromANGLE",
                      "--disable-vulkan-surface",
                    ]
                  : []),
              ]
            : [],
    },
  };
}

/** Launch the selected backend, enforce adapter identity, and persist cold diagnostics on shutdown. */
export async function launchValidationBrowser() {
  const { profile, options } = validationBrowserOptions();
  const browser = await chromium.launch(options);
  const newPage = browser.newPage.bind(browser);
  const close = browser.close.bind(browser);
  const pages = [];
  browser.newPage = async (options) => {
    // Install before navigation so every app and recovered device uses the verified profile.
    const page = await newPage(options);
    // Software rasterization gets a bounded startup allowance; scene assertions and workloads stay identical.
    page.setDefaultTimeout(profile === "software" ? 120_000 : 30_000);
    pages.push(page);
    if (process.env.RENDERER_VALIDATION_PROGRESS === "1")
      page.on("console", (message) => {
        // Forward only explicit cold scenario milestones; never log per-frame commands.
        if (
          message.type() === "info" &&
          message.text().startsWith("[GPU validation]")
        )
          console.log(message.text());
      });
    await page.addInitScript((profile) => {
      // Wrap adapter requests rather than guessing the backend from host platform or launch flags.
      const gpu = navigator.gpu;
      globalThis.__gpuValidation = { profile, adapters: [], failures: [] };
      if (!gpu) return;
      const request = gpu.requestAdapter.bind(gpu);
      gpu.requestAdapter = async (options) => {
        // Snapshot only cold adapter metadata; this never instruments frame encoding.
        const adapter = await request(options);
        if (!adapter) return adapter;
        const info = adapter.info;
        const description = {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
          isFallbackAdapter:
            info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false,
        };
        const software =
          description.isFallbackAdapter ||
          /swiftshader|llvmpipe|software/i.test(
            Object.values(description).join(" "),
          );
        const snapshot = {
          ...description,
          features: [...adapter.features].sort(),
          limits: Object.fromEntries(
            Object.keys(Object.getPrototypeOf(adapter.limits))
              .map((key) => {
                // Retain numeric WebGPU limits without methods from the interface prototype.
                return [key, adapter.limits[key]];
              })
              .filter(([, value]) => {
                // Skip prototype methods and nonnumeric metadata.
                return typeof value === "number";
              }),
          ),
        };
        globalThis.__gpuValidation.adapters.push(snapshot);
        if (
          (profile === "software" && !software) ||
          (profile === "hardware" && software)
        ) {
          const message = `GPU profile ${profile} received incompatible adapter: ${JSON.stringify(description)}`;
          globalThis.__gpuValidation.failures.push(message);
          throw new Error(message);
        }
        return adapter;
      };
    }, profile);
    return page;
  };
  browser.close = async () => {
    // Preserve failure evidence even when a scenario throws, then always release Chromium.
    try {
      const diagnostics = [];
      for (const page of pages) {
        if (!page.isClosed())
          diagnostics.push(
            await page
              .evaluate(() => {
                // Read only the metadata recorded by cold adapter requests.
                return (
                  globalThis.__gpuValidation ?? {
                    failures: ["No adapter instrumentation"],
                  }
                );
              })
              .catch((error) => {
                // Keep navigation/crash diagnostics without hiding the original scenario failure.
                return { failures: [error.message] };
              }),
          );
      }
      await mkdir("artifacts/gpu-environments", { recursive: true });
      await writeFile(
        `artifacts/gpu-environments/${basename(process.argv[1], ".mjs")}-${profile}.json`,
        JSON.stringify(
          {
            profile,
            launch: options,
            node: process.version,
            platform: process.platform,
            architecture: process.arch,
            browser: browser.version(),
            timestamp: new Date().toISOString(),
            pages: diagnostics,
          },
          null,
          2,
        ),
      );
      for (const diagnostic of diagnostics) {
        if (diagnostic.failures?.length)
          throw new Error(diagnostic.failures.join("\n"));
        if (!diagnostic.adapters?.length)
          throw new Error("GPU validation did not obtain an adapter");
      }
    } finally {
      await close();
    }
  };
  return browser;
}
