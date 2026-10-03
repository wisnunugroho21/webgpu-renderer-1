# WebGPU renderer

TypeScript/Vite renderer following [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). The initial repository was empty. See [PROGRESS.md](PROGRESS.md) for phase-by-phase validation, benchmark evidence, limitations and the next incomplete phase.

```sh
npm ci
npm run dev
```

Open the displayed localhost URL in a WebGPU-capable browser. The initial scene is an indexed cube. Resize handling uses physical pixel dimensions and device limits; device loss stops rendering and reports the loss.

## Validation

```sh
npm test
npm run build
npm run validate:gpu
RENDERER_PREVIEW=1 npm run validate:gpu
npm run benchmark -- --outputJson artifacts/benchmarks.json
```

The GPU harness requires installed Google Chrome and a usable WebGPU adapter. It starts its own server on port 5173, checks pixel output, camera movement without resource creation, resize, device loss, material modes, offscreen rejection, GLB loading, and full-image equivalence for 10,000 individual/sorted/instanced cubes. It also compares linear and static BVH rendering. GPU completion waits and mapped readbacks are confined to this harness.

Production preview validation requires `npm run build` first. CPU benchmark results are machine-specific and exclude GPU pass timing. Construction cost is excluded from BVH query benchmarks. BVH remains opt-in because it was slower in the fully visible scene despite improving the mostly rejected static benchmark.

Historical evidence is saved in `benchmarks/results/`; fresh local results and screenshots go to `artifacts/`.

## Runtime API

In the browser console after initialization:

```js
await window.rendererApp.loadAsset('/regression/triangle.glb');
window.rendererApp.renderer.camera.setPosition(0, 0, 5);
window.rendererApp.renderer.visibilityMode = 'bvh';
```

The loader uses [glTF Transform core](https://gltf-transform.dev/) for container/accessor decoding and converts the decoded document to engine-owned data. Render passes read `RenderWorld`; shared GPU assets are addressed by numeric mesh/material IDs. Loading adds the selected scene to the world. The synthetic GLB fixture can be regenerated with `node scripts/create-regression-assets.mjs`.

Entity and material capacities are explicit. Entity IDs are monotonic, preventing stale-ID aliasing; exhausted capacity fails rather than allocating GPU resources in the frame loop. BVH-static objects are marked with `RenderFlags.STATIC`; changes invalidate the snapshot hierarchy. Gameplay changes should use transform setters so dirty propagation occurs.

Completed work reaches the basic static asset loader. Textured PBR, animation/deformation and the later GPU-driven stages remain on the plan.
