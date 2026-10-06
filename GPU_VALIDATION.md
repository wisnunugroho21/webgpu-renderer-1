# Reproducible GPU validation

Install the frozen workspace dependencies and build before individual production gates:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
```

`pnpm validate` stops at the first failure: lint, formatting, CPU tests, production build, then eighteen GPU scenario gates. Tests cover resource ownership, animation/deformation, codecs, particles, transparency, shadows, streaming, post-processing, motion/TAA, transmission and recovery. Diagnostic GPU waits/readbacks belong only to these harnesses; production rendering does not acquire them.

## Backend profiles

Existing commands default to installed Chrome and the native adapter. Use the bundled Chromium binary to match the Playwright revision in `pnpm-lock.yaml`:

```sh
RENDERER_GPU_PROFILE=software RENDERER_BROWSER_CHANNEL=chromium pnpm validate
RENDERER_GPU_PROFILE=software RENDERER_BROWSER_CHANNEL=chromium pnpm benchmark:gpu --long-animation
```

The software profile explicitly selects SwiftShader with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader` and configures ANGLE with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` so canvas presentation also uses software rendering. The `chromium` channel selects the bundled full browser in [new headless mode](https://playwright.dev/docs/browsers#chromium-new-headless-mode). These flags are restricted to validation browser launches. Every cold adapter request, including recovery, records its actual metadata and rejects a hardware adapter. See [Chromium's SwiftShader documentation](https://github.com/chromium/chromium/blob/main/docs/gpu/swiftshader.md) and [Chromium's WebGPU backend reproduction](https://issues.chromium.org/issues/492139412).

On a machine provisioned with hardware WebGPU:

```sh
RENDERER_GPU_PROFILE=hardware RENDERER_BROWSER_CHANNEL=chromium pnpm validate
RENDERER_GPU_PROFILE=hardware RENDERER_BROWSER_CHANNEL=chromium pnpm benchmark:gpu --long-animation
```

The hardware profile enables GPU/WebGPU headless operation and rejects fallback/SwiftShader/software adapters. Linux hardware runners use ANGLE/Vulkan (`Vulkan,VulkanFromANGLE`, no Vulkan presentation surface) and require a working native Vulkan driver; macOS/Windows retain their native backend. See [Chromium hardware headless guidance](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md). It never forces software when the requested hardware is unavailable. Set `RENDERER_BROWSER_CHANNEL=chrome` to use installed Chrome when diagnosing a browser difference. `native` leaves backend selection unchanged but still records it. Unknown profiles fail before launch. Software page readiness/navigation and recovery progress get a bounded 120-second allowance; native/hardware recovery uses thirty seconds. Recovery checks actual ready/resumed-frame states instead of assuming two-second setup and 100-ms presentation. Responsiveness checks count main-thread macrotask progress, retaining presented-frame counts as diagnostics. Scene sizes, frame counts, pixel comparisons and resource assertions are unchanged.

Each gate saves `artifacts/gpu-environments/<script>-<profile>.json` with browser/Node/platform, actual adapter vendor/architecture/fallback identity, features and numeric limits. Scenario results and screenshots remain in `artifacts/`; the long-animation matrix includes its verified adapter metadata. Successful resource tests assert warm counter equality and complete tracked disposal.

## CI and benchmarks

`.github/workflows/validate.yml` runs the complete suite and long-animation matrix on Ubuntu 24.04 with software rendering. Actions are pinned to commit hashes, Node is pinned to 24.14.0, pnpm to 12.6.0, dependencies to the committed lockfile, and the browser to the locked Playwright revision. Installation follows [Playwright's CI instructions](https://playwright.dev/docs/ci), including Chromium's Linux system dependencies. Failure logs and artifacts upload even when a gate fails. CI sets `RENDERER_VALIDATION_PROGRESS=1` to print cold stress-phase milestones; the same flag helps diagnose long local runs.

The manual workflow input `hardware=true` additionally dispatches the same suite to a self-hosted Linux runner carrying the `linux` and `webgpu` labels. Provision its GPU driver and Chromium runtime dependencies first. Hardware execution is explicit and runs only through manual dispatch; pull requests use hosted software validation. Saving a workflow does not establish that GitHub has run it or that such a hardware runner exists.

Timings are diagnostic. Compare medians only within the same adapter, operating system, browser and backend, on an otherwise idle machine; SwiftShader timing is not a hardware performance baseline. The matrix's assertions enforce draw/upload/deformation/image/resource invariants independently of timing. `scripts/compare-benchmarks.mjs` compares the earlier transparency baseline with the completed improvements, permitting only the documented default optical material/fallback allocation deltas. New opt-in features have independent benchmark evidence in `benchmarks/results/`.
