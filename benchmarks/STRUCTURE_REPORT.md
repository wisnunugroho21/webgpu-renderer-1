# Codebase ownership and maintenance refactor

The repository review identified concentrated lifecycle, decoder and color-pass responsibilities. Focused modules now own those responsibilities while existing application/renderer APIs and import paths remain usable. ECS, math, animation sampling, shared buffer layouts and pass ordering retain their existing behavior.

| Boundary                                            | Ownership after restructuring                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Application / ApplicationAssets                     | Browser/frame lifecycle versus asset leases, instantiation, rollback and unload vetoes     |
| Application / rebuildDeviceResources                | Publishing CPU/application state versus preparing and validating replacement GPU ownership |
| GLTFLoader / GLTFCodecs / convertRuntimeAsset       | Fetch/decode facade, lazy decoder dependencies, pure engine-data conversion                |
| Renderer / ColorPass                                | Snapshot/frame orchestration versus color variants, HDR/IBL inputs and draw encoding       |
| MaterialTextures / TextureUploader / TextureSampler | Cache leases and transactions, decode/upload cleanup, glTF sampler policy                  |
| EnvironmentLoader / decodeEnvironmentPanorama       | Bounded bake cache versus HDR/EXR format normalization                                     |

Shared content hashing and named color-pipeline offsets replace duplicated policy. Comments explain ownership, asynchronous publication, bitmap cleanup and cold versus frame operations. The codebase guide maps these boundaries. `npm run validate` runs formatting, tests, production build and all browser validations in order and stops at the first failure. Timed benchmarks remain separate.

The main facades become smaller: Application 561 → 417 lines, Renderer 837 → 710, GLTFLoader 273 → 27, MaterialTextures 336 → 246, EnvironmentLoader 198 → 125. The extracted code remains in focused modules; these counts describe readability boundaries rather than a reduction in functionality or total implementation complexity.

Validation covers 205 tests across 54 files, strict TypeScript/production build, full renderer regression and every asset/game/lighting/HDR/recovery/environment/codec browser gate. Two added tests protect disposal between recovery preparation/publication and failure cleanup during publication. Existing gates retain synchronous consumer detachment before GPU fencing, the current device queue, dynamic clear-color replacement, exact deformation images, decoder worker behavior, retryable recovery and zero final GPU ownership. Default-off optional features and all GPU ABIs remain unchanged.

The before/after long GPU matrices pass image/reference checks and preserve all 86 counter/resource snapshots exactly. Representative CPU/completion medians, milliseconds:

| Workload                             | Before CPU | After CPU | Before completion | After completion |
| ------------------------------------ | ---------: | --------: | ----------------: | ---------------: |
| 100 long-clip characters             |        2.5 |       2.5 |               3.7 |              3.7 |
| 500 long-clip characters             |       13.0 |      12.7 |              15.2 |             14.8 |
| 1,000 long-clip characters           |       25.4 |      25.7 |              28.9 |             29.2 |
| 1,000 combined morph/skin characters |       26.6 |      26.7 |              31.5 |             31.9 |

The 1,000-character encoding median changes 1.6 → 1.7 ms; the combined case stays 1.7 ms. Small differences, independent runs, timer resolution and JIT/scheduling variation limit performance conclusions. This restructuring does not establish a speedup, and the largest animation workloads still exceed a 16.7 ms CPU budget. Warm resource creation stays fixed; no new frame resource allocation, decoder work, completion wait or readback is introduced.

Reproduce with `npm run validate` and `npm run benchmark:gpu -- --long-animation`. Raw evidence: `results/structure-{before,after}-matrix.json`, `results/structure-regression.json`, `results/structure-{assets,recovery,environments,codecs}.json`.
