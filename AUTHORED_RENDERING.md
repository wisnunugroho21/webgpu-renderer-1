# Local shadows and authored PBR

Point and spot lights use the existing shared shadow depth array, caster instance pool, deformation shader and cache. Built-in PBR materials support authored clearcoat, dielectric specular/IOR, stronger emission, unlit shading and independent texture transforms. These features use the existing render graph and direct/HDR draw paths.

## Point and spot lights

```ts
const light = app.world.create();
app.world.transforms.add(light);
app.world.transforms.setPosition(light, 2, 4, 1);
app.world.lights.set(light, {
  type: "point", // "spot" uses one cone projection instead
  color: [1, 0.8, 0.6],
  intensity: 40,
  range: 15,
  castShadow: true,
  shadowNear: 0.05,
  shadowBias: 0.0001,
  shadowNormalBias: 0.005,
});
app.renderer.shadows.enabled = true;
```

For a spot light add `direction: [0, -1, 0]`, `innerCone: 0.2`, and `outerCone: 0.6`. Cone angles are radians; a shadow-casting spot requires a representable positive outer angle strictly below π/2, with inner ≤ outer. Existing light extraction transforms its direction into world space. Set its position through the entity transform.

A spot reserves one layer; a point reserves six (+X, −X, +Y, −Y, +Z, −Z). Directional lights reserve `shadows.cascades` layers each, with at most four directional shadow lights. All types share **16 layers**, fixed at 1024² `depth32float`. The allocation remains 64 MiB regardless of how many lights cast shadows. Two points and four single-layer spots fit; three points exceed capacity. Preparation rejects over-capacity configurations before changing light-to-layer metadata or uploading shadow matrices. Disable unnecessary casters or reduce directional cascade counts rather than expecting silent omissions.

Local far coverage uses the light's positive `range`; an unbounded (`range: 0`) light uses `shadows.shadowDistance` for shadow coverage only. Illumination still follows its ordinary attenuation. Keep `shadowNear` below that far distance. Bias applies to directional lights too. Larger normal bias can hide acne but detach shadows; smaller depth bias can improve contact but introduce self-shadow artifacts. Choose values for your scene's world scale.

Use `world.lights.set(...)` to replace a light's settings with validated values; omitted values take defaults. The existing typed component arrays remain available for controlled updates. Toggle `world.lights.castShadow[light]` or `renderer.shadows.enabled`; `cacheEnabled` and `cullingEnabled` also apply to local lights. Unchanged cached layers skip depth rendering. Changed lights, geometry, deformation or material coverage invalidate affected cache state. Camera-dependent caster ordering can invalidate otherwise stationary local maps.

Alpha-masked meshes cast their masked silhouette, including texture transforms. Skinning and morphing match color/depth rendering. Blended meshes and particles do not cast opaque shadows. Filtering uses nine comparison taps in the selected 2D face; it does not perform cross-face cube filtering, so point-map seams can be visible near face boundaries. Point lights can cost six caster traversals/passes when invalidated; prefer spot shadows when their coverage fits the effect.

## Material factors

```ts
const material = app.materials.create({
  baseColor: [0.7, 0.15, 0.05, 1],
  metallic: 0,
  roughness: 0.35,
  ior: 1.5,
  specular: 0.8,
  specularColor: [1, 0.8, 0.6], // linear RGB
  clearcoat: 1,
  clearcoatRoughness: 0.12,
  clearcoatNormalScale: 1,
  emissive: [0.1, 0.02, 0],
  emissiveStrength: 4,
});
```

`ior` defaults to 1.5 and accepts ≥1, or zero for glTF's infinite-IOR compatibility mode. `specular` defaults to 1 and is in [0,1]; it changes dielectric reflections, not metal reflectance. `specularColor` defaults to white, is linear/nonnegative and may exceed one; the dielectric Fresnel product is clamped to conserve energy. Clearcoat weight and roughness are in [0,1]; clearcoat defaults to zero. Its independent normal comes from the geometric normal or its own map, rather than the already perturbed base normal. Direct light, environment reflections and underlying emission receive coat layering. GGX roughness is floored at 0.045 for stable highlights; indirect coat uses the existing split-sum approximation.

`emissiveStrength` defaults to 1 and multiplies emissive RGB/maps before HDR presentation and bloom. Values must fit finite f32 storage. Enable `renderer.hdr.enabled` and optionally bloom to preserve/display bright emission. `unlit: true` uses only base color, vertex color, base texture and alpha; glTF unlit ignores emissive and light-related fields.

`materials.set(id, material)` replaces the record and resets omitted fields to defaults. Shader family and parameter APIs keep their existing contracts. Custom shaders receive transformed core texture samples and scaled emission in `MaterialSurface`; their own `shadeMaterial` function determines lighting. Built-in authored coat/specular/unlit behavior does not override a custom family. The existing `directLighting`, `directBRDF` and `ambientLighting` WGSL helpers retain their signatures and default behavior.

## Authored assets and maps

Load glTF/GLB through `app.loadAsset(url)` or `instantiateAsset(url)`. The loader lazily registers:

- `KHR_materials_clearcoat`: factors and all three maps.
- `KHR_materials_ior` and `KHR_materials_specular`: IOR, weight, tint and both specular maps.
- `KHR_materials_emissive_strength` and `KHR_materials_unlit`.
- `KHR_texture_transform`: per-role offset, rotation, scale and optional UV-set override.

| Map role                 | Channels / decoding             |
| ------------------------ | ------------------------------- |
| baseColor                | RGB sRGB; alpha linear          |
| metallicRoughness        | G roughness, B metallic; linear |
| normal / clearcoatNormal | Tangent-space XYZ; linear       |
| occlusion                | R; linear                       |
| emissive                 | RGB sRGB                        |
| clearcoat                | R weight; linear                |
| clearcoatRoughness       | G roughness; linear             |
| specular                 | A weight; linear                |
| specularColor            | RGB sRGB                        |

Factors multiply their texture values. Missing maps use neutral fallbacks; optional extension flags bypass absent-map sampling. Encoded textures are deduplicated by content and color interpretation. Raster, mip-chain, compressed/Basis texture paths retain their existing ownership rules; normal fallbacks use flat normals for both normal roles.

Runtime texture metadata uses `texCoord` (0 or 1), optional `offset: [u,v]`, `scale: [u,v]`, and `rotation` in radians. UV order is `offset + rotation × scale × UV`. Identity transforms take the unchanged coordinate path. Normal maps on UV1 or transformed coordinates derive the tangent frame from UV/world derivatives; degenerate UVs retain the available geometric/tangent fallback. Color, camera depth and shadow alpha coverage use the same base-map transform. Optional-map gradient sampling preserves mip/anisotropic filtering.

Creating a material with `textures` describes its metadata; it does not upload images. Use asset loading/material texture preparation for GPU bindings. Streaming replacements via `renderer.streaming.bindMaterial(...)` replace texture metadata while retaining scalar factors. `releaseMaterial(id)` restores original groups, map flags and affine transforms. The legacy six-word `textureLayout(id)` remains available; use `textureLayout(id, true)` for complete 87-word snapshots when restoring authored layouts. Renderer streaming already does this.

Transmission, volume/refraction, sheen, anisotropy, iridescence and arbitrary extra texture bindings remain outside this material extension. Imported punctual light creation is not added by this work; create ECS lights as above.

## Layout, cost and validation

One fixed shared material record is now **112 f32 / 448 bytes**, including 10 affine UV transforms. The default 2048-row table grows from 160 KiB to 896 KiB. Dirty uploads use the larger stride; unchanged frames upload no material rows. The existing binding order for five core maps is preserved and five authored maps are appended: 10 textures/samplers per material group. With environment and shadows this uses 14 sampled textures and 12 samplers, within baseline WebGPU limits. No per-light/material GPU buffers, extra per-frame groups, unbounded shader families, readbacks, waits or steady GPU creation are introduced.

Run `pnpm validate:authored` after `pnpm build` for local shadow images/cache/culling, authored maps/channels, alpha-depth transforms, submission modes, streaming restoration and recovery. Run `pnpm validate` for the complete gate. Benchmarks and practical limits are recorded in [benchmarks/AUTHORED_RENDERING_REPORT.md](benchmarks/AUTHORED_RENDERING_REPORT.md).
