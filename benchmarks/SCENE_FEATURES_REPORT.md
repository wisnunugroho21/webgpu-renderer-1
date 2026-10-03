# Runtime animation layers and optional environment lighting

Implemented the fourth improvement recommendation on 2026-10-04. Animation layers build on Phase 26's component-space poses. Image-based lighting is an opt-in extension to PBR; no environment GPU resources or additional pipelines are constructed by default. Phase 44 stays optional/default-off.

## Animation layers

Animator exposes `addLayer`, `removeLayer`, `clearLayers`, a stable readonly `layers` list and `evaluate`. Each layer owns a playback clock, speed, loop/playing controls, validated weight, persistent sample buffers and key hints. Node masks resolve once from authored glTF node indices. Shared clip data remains immutable. Ordered override layers blend components; local additive layers use translation/morph differences, scale ratios and reference-relative quaternion composition. References are sampled once during setup. Missing/masked channels leave the base composite unchanged.

The base pose is reconstructed before layering each frame, avoiding accumulation. A separate persistent layered result preserves the unlayered base for interrupted crossfades. Clearing/removing layers restores base/rest channels, including targets absent from the active base clip. Controller pause freezes all clocks; stop rewinds layer clocks; evaluate samples without advancing, including while paused. A nonlooping base reaching its endpoint stops the controller, retaining existing controller semantics.

GPU checks use a 64-joint/16-morph character with depth prepass and directional shadows enabled. Full-weight override matches direct clip playback byte-for-byte. Zero weight and clearing restore the original image. Joint upload remains 4,096 bytes; depth/shadow passes execute. Adding/toggling/removing layers creates no GPU resources.

## Environment lighting

The environment stores one shared diffuse cube, GGX-prefiltered specular cube, RG split-sum BRDF LUT and 16-byte parameter buffer. Data is linear HDR and uploads as filterable rgba16float, without optional float32 filtering features. A second bounded PBR pipeline table is constructed on first installation and reused for every subsequent environment. Frame/object/material ABIs and depth/shadow shaders are preserved. Scene-wide group 2 carries environment bindings; individual materials do not own environments.

`bakeEnvironment` performs cold cosine-weighted diffuse convolution, GGX importance filtering and correlated-Smith BRDF integration. `panoramaSampler` adapts decoded linear RGB equirectangular pixels; callers may instead supply an analytic radiance function or externally precomputed cubes/LUT. The split-sum arrangement follows the [Khronos renderer's IBL separation](https://github.com/KhronosGroup/glTF-Sample-Renderer/blob/main/source/Renderer/shaders/ibl.glsl); the convolution/integration conventions are described by the [Khronos IBL sampler](https://github.com/KhronosGroup/glTF-IBL-Sampler/blob/main/lib/source/shaders/filter.frag). This implementation uses a single-scattering approximation, without the sample renderer's additional material extensions or multiple-scattering compensation.

Installation/replacement validates data before allocation, scopes GPU validation, commits only on success and fences retirement of the old environment. Calls serialize; failed uploads preserve the active environment, and disposal rejects pending installations and releases ownership. `setEnvironment(null)` releases all three textures and the buffer. Cached shader/pipelines/sampler remain until renderer disposal. Intensity/yaw write only changed 16-byte uniforms; disabling/re-enabling reuses installed resources. No environment preprocessing, GPU waits or readbacks run in ordinary rendering.

The material-grid demo at `/?example=lighting` uses one shared smooth sphere mesh, two metallic rows, six roughness columns and a procedural HDR environment. E toggles IBL; arrow keys rotate it. Its camera fits landscape and portrait viewports. Input handlers, hooks and HUD clean up with the example; shared GPU geometry/materials remain renderer-owned until application disposal.

## Validation and measurements

192 tests across 50 files, strict TypeScript/production build and formatting pass. Tests cover composition, masks, independent playback, reverse/nonloop timing, pause/stop, interrupted fades, invalid controls, constant radiance conservation, GGX broadening, cube directions, panorama seams/poles, binary16 rounding, malformed data, transactional failures, serialization, retirement fences and disposal.

Real Chrome WebGPU production-preview checks pass:

- Constant HDR environment matches the analytic split-sum reference exactly: center RGB 127/127/127, expected 127.
- Zero intensity gives black center pixels with direct light/emissive disabled.
- Individual/sorted/instanced/GPU-indirect full images are identical.
- Disabled/resumed/failed replacement images preserve their references; roughness and yaw change the rendered image.
- Warm frames/toggles create no pipelines, shaders, textures, buffers or samplers. Clearing returns live textures, buffers and buffer bytes to baseline.
- Demo keyboard controls pass without warm resource construction. Screenshot: local `artifacts/environment-lighting.png`.
- Full existing renderer regression, default GPU matrix, game API and asset lifecycle regressions pass with zero GPU/page errors. All 86 default matrix counter/resource snapshots match the previous long-animation matrix exactly.

CPU benchmark means (ms), run serially; construction is excluded except for the explicitly cold bake:

| Workload                                                | Baseline / final               |
| ------------------------------------------------------- | ------------------------------ |
| 1,000 original two-key TRS controllers                  | 0.1943 / 0.2022                |
| 10,000 original two-key TRS controllers                 | 5.5109 / 5.4029                |
| 1,000 characters × 64 joints, 1,024-key clips           | 11.9790 / 11.8069              |
| 1,000 STEP TRS + morph controllers                      | 0.1893 / 0.1932                |
| 1,000 LINEAR TRS + morph controllers                    | 0.2246 / 0.2297                |
| 1,000 CUBICSPLINE TRS + morph controllers               | 0.2521 / 0.2588                |
| 1,000 STEP crossfades                                   | 0.8268 / 0.8160                |
| 1,000 LINEAR crossfades                                 | 1.1301 / 1.1074                |
| 1,000 CUBICSPLINE crossfades                            | 0.8577 / 0.8871                |
| 1,000 translation controllers, 0 / 1 / 4 layers         | final 0.0606 / 0.1617 / 0.3877 |
| Cold 16px specular / 4px diffuse / 16px LUT, 64 samples | final 3.4644                   |

This adds capabilities, not a universal speedup. Some no-layer cases cost roughly 2–4% more while others improve; timings vary and raw runs are retained. Layer benchmark poses continue changing each iteration; additional layers intentionally cost additional sampling/composition.

The focused real GPU scene is one skinned/morphed surface, with depth/shadows and visibility paths warmed. Its final off/on CPU encoding medians are about 0.1/0.0 ms and completion medians about 0.9/0.8 ms; previous runs varied up to 1.1 ms with IBL on. These submillisecond results are noisy and do not establish an IBL speedup. A heavier 32-surface transparent workload (31 enlarged planes plus the animated surface, without depth prepass/shadows) measures 4.7 ms off / 5.1 ms on, with CPU encoding 0.2 ms in both modes. Both workloads reuse warm resources and include diagnostic GPU completion waits; results do not establish a general performance ratio. Installing the first environment measured 386.7 ms in the initial run and 18 ms in a later run; GPU/driver cache and compilation conditions are not controlled. Subsequent replacements reuse the shader/pipeline table. First installation adds 3 textures, 1 buffer (16 bytes), 1 shader, 1 sampler and 32 distinct cached render pipelines on the tested adapter; descriptor variants are bounded to the same 72 color modes as the existing table.

Environment resolution/sample count determine preprocessing time and quality. Bake offline or during loading, never in gameplay hooks. Input pixels must remain immutable until installation completes. This API does not decode HDR/EXR files, render a skybox, add tone mapping, or automatically load environments from glTF extensions. Existing output conversion is retained, so linear HDR highlights beyond the display range clip. These boundaries are explicit rather than silently substituting ordinary mipmaps for prefiltering.

## Reproduce

```sh
npm test
npm run build
npm run validate:features
npm run benchmark -- tests/animation.bench.ts tests/animation-long.bench.ts tests/animation-layers.bench.ts tests/environment.bench.ts --outputJson artifacts/features-cpu.json
RENDERER_PREVIEW=1 npm run validate:gpu
npm run benchmark:gpu
npm run validate:game
npm run validate:assets
npm run format:check
```

Feature checks use port 5193. Timing jobs should run serially. Evidence: `benchmarks/results/scene-features*.json`, with the compact comparison in [scene-features.json](results/scene-features.json).
