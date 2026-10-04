# HDR rendering and tone mapping — 2026-10-04

Optional HDR renders the entire linear scene into rgba16float, including alpha blending, before one fullscreen exposure/Reinhard presentation pass. The final sRGB attachment encodes display values exactly once. The original direct color path remains the default. HDR is SDR presentation of high dynamic range scene lighting, not HDR monitor output. Reinhard uses the per-channel curve x/(1+x); `clamp` provides exposure plus a linear clamp for comparison. No automatic exposure, bloom or HDR/EXR decoding is added.

Cold enable creates bounded PBR format variants, a fullscreen pipeline, one 16-byte uniform and one full-resolution texture. Environment HDR variants are prepared on cold installation/enable in either order. Warm frames reuse all resources, with only dirty exposure/curve writes. Disabling retains resources; resize replaces the target; renderer disposal releases buffers/textures. Target memory is 8 bytes/pixel, approximately 15.8 MiB at 1080p. Half-float overflow saturates to 65504 at presentation. Exposure is finite −16..16 stops.

## Validation

`pnpm run validate:hdr` checks actual Chrome WebGPU output:

- Grayscale scene radiances 0, .18, 1, 2, 4, 16, 65504 and overflow agree with the analytic Reinhard→sRGB reference within one byte. 1/2/4/16 map to 188/213/231/248, preserving highlights that direct output clips.
- Exposure ±1 stops agrees with doubling/halving radiance; extreme valid exposure is finite; invalid settings are rejected. Clamp at zero stops agrees with legacy output.
- Disabling HDR restores the full original image exactly.
- A half-transparent emissive surface with radiance 4 over black maps blended radiance 2 to 213, proving blending precedes tone mapping.
- All four submission modes agree; a second full-image comparison covers combined morph/skin, depth, shadows and environment lighting.
- Hi-Z debug follows tone mapping, resize validates, warm resource counts stay fixed and disposal returns buffer/texture ownership to zero.
- The demo installs IBL before enabling HDR and exercises actual H/−/+ controls with unchanged resource counts.
- No scoped/uncaptured GPU validation errors or page errors.

All 192 existing tests, strict TypeScript/production build, full renderer GPU regression, default benchmark matrix and scene-feature GPU checks pass. All 86 default counter/resource snapshots are unchanged; graph schedule adds the disabled tone-mapping callback after color.

## Measurements

Focused 640×480 GPU checks warm 30 frames and measure 60 frames per mode. CPU encoding and diagnostic queue-completion waits are measured separately; waits occur only in the harness. A simple combined animated/IBL scene and a 32-cube transparent overdraw workload are included. Exact timings and cold setup cost are in [raw HDR results](results/hdr.json). The final run gives 0.8 ms completion with HDR off / 0.9 ms on; the heavier workload gives 9.3 ms off / 8.7 ms on. These results do not establish a speedup: target-format blending, driver caches and scheduling vary. HDR adds target bandwidth and a fullscreen pass. The final captured tone-map timestamp is 0.066 ms (an earlier capture was 0.328 ms) on the tested adapter, with coarse timestamp quantization. Earlier runs varied; no general performance ratio is asserted.

## Reproduce

```sh
pnpm test
pnpm run build
pnpm run validate:hdr
RENDERER_PREVIEW=1 pnpm run validate:gpu
pnpm run benchmark:gpu
pnpm run validate:features
pnpm run format:check
```

HDR validation uses isolated preview port 5194. Run timing jobs serially. `/?example=lighting` enables HDR and supports H toggle, −/+ half-stop exposure, E lighting toggle and arrows for environment rotation.
