# Custom shader materials

Custom materials replace surface RGB shading while reusing the renderer's geometry, coverage, textures and draw paths. They work alongside built-in PBR materials. Run `pnpm run dev` and open `/?example=shaders` for animated world-space bands; click the canvas and press M to switch between custom shading and PBR.

## Register and use a shader

Register after `await app.start()`, during scene loading or another cold setup boundary:

```ts
const shaderId = await app.registerMaterialShader({
  name: "unlit-tint",
  source: `
// Returns linear RGB; alpha remains governed by the material's alphaMode/baseColor.
fn shadeMaterial(surface: MaterialSurface, parameters: MaterialShaderParameters) -> vec3<f32> {
  return surface.baseColor.rgb * parameters.values[0].rgb + surface.emissive;
}`,
});
const materialId = app.materials.create({
  shaderId,
  baseColor: [0.8, 0.2, 0.1, 1],
  shaderParameters: [1, 1, 1],
  alphaMode: "OPAQUE",
});
app.world.meshes.set(app.sceneEntity, 0, materialId);
```

`surface.baseColor` already includes vertex color and the base-color texture. The bootstrap cube has colored faces, so its vertex color affects this example. Values returned by `shadeMaterial` are linear radiance. Do not apply gamma encoding or tone mapping inside this function; presentation handles those once, after transparent blending.

The required signature is:

```wgsl
fn shadeMaterial(surface: MaterialSurface, parameters: MaterialShaderParameters) -> vec3<f32>
```

The source can include additional ordinary WGSL helper functions. It must not declare attributes/bindings/entry points, `discard`, overrides or extension directives. Compilation failures reject registration with diagnostics and do not publish a family ID. Registration is serialized; an identical name/source returns its existing ID. Reusing a name with different source is rejected.

## Surface inputs

| Field                       | Meaning                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `baseColor: vec4<f32>`      | Material factor × vertex color × sampled base-color texture.                                       |
| `emissive: vec3<f32>`       | Emissive factor × sampled emissive texture, in linear RGB.                                         |
| `metallic: f32`             | Factor × metallic map channel, clamped to [0, 1].                                                  |
| `roughness: f32`            | Factor × roughness map channel, clamped to [0.045, 1].                                             |
| `normal: vec3<f32>`         | World-space normal after normal mapping and double-sided handling. Degenerate normals can be zero. |
| `worldPosition: vec3<f32>`  | Position after the existing morph, skin and model transforms.                                      |
| `viewDirection: vec3<f32>`  | Direction toward the eye; orthographic projection uses the camera direction.                       |
| `occlusion: f32`            | Sampled material ambient occlusion with strength applied.                                          |
| `materialId: u32`           | Shared material table index.                                                                       |
| `uv0`, `uv1: vec2<f32>`     | The two supported texture-coordinate sets.                                                         |
| `screenPosition: vec2<f32>` | Fragment position in physical render-target pixels.                                                |

The stable definition is in [material-surface.wgsl](src/shaders/material-surface.wgsl). Use the existing `directLighting(...)` and `ambientLighting(...)` helpers if your shader needs renderer lights, shadows, clusters or environment lighting. A shader that only returns base color is unlit; lighting is not automatically applied to its returned RGB.

The existing five texture roles remain available: base color, metallic/roughness, normal, occlusion and emissive. Imported glTF textures use the normal asset/texture ownership path. Additional arbitrary texture bindings are outside this surface API.

## Parameters and runtime changes

Every material has up to 16 finite f32 parameters, exposed as four `vec4<f32>` values. For example, parameter indices 0–3 occupy `parameters.values[0]`; indices 4–7 occupy `values[1]`. Omitted values are zero. Oversized arrays, NaN, infinity and values that overflow f32 are rejected before mutation.

Use a reusable array for animated parameters:

```ts
const parameters = new Float32Array([1, 1, 1, 0]);
const off = app.onUpdate((dt) => {
  // Advance shader time in a retained parameter array, with no vertex deformation or temporary arrays.
  parameters[3] = parameters[3]! + dt;
  app.materials.setShaderParameters(materialId, parameters);
});
// Scene teardown: off();
```

`setShaderParameters` replaces the parameter row and zero-pads it. A changed row is 64 bytes; multiple changed rows are uploaded as one encompassing dirty range. Unchanged frames perform no custom-parameter upload. This is a shared buffer rather than one buffer/bind group per object. Calling the setter every frame marks the row dirty even if the supplied values are identical; call it only when needed.

Switch an existing material without resetting its PBR factors or texture metadata:

```ts
app.materials.setShader(materialId, shaderId); // Retains current parameters.
app.materials.setShader(materialId, shaderId, [1, 0.5, 0.2]); // Replaces parameters.
app.materials.setShader(materialId, 0); // Built-in PBR.
```

This is useful for imported materials: apply it to their material IDs after loading. Shared material IDs affect every entity referencing them. `materials.set(id, description)` still replaces a complete material description, so omitted `shaderId` selects PBR and omitted parameters become zero. Avoid writing `shaderIds` or parameter arrays directly; use the setters for validation/version tracking and dirty uploads.

## Rendering contracts

Custom shaders retain the existing vertex entry points, instancing, direct/indirect submission, authored LOD, skinning and morphing. Static cluster optimization remains available for otherwise eligible geometry. Alpha modes, sidedness, blending and transparent sorting remain material settings.

The shader returns RGB only. Alpha masking uses the same base-color alpha/cutoff in color, depth and shadows. Custom vertex displacement, custom alpha/discard rules and fragment depth output are not supported by this API. Those effects require matching vertex/coverage hooks in every geometry pass and correct conservative bounds; use a separate future extension rather than bypassing the current contract.

HDR, tone mapping, bloom and FXAA consume custom radiance through the existing presentation path. Values above one can contribute to HDR/bloom. Environment layout changes and HDR enablement prepare retained family variants on their cold setup paths. Device recovery rebuilds registered definitions and parameter storage from retained CPU state.

## Performance and lifetime

Family zero is PBR. Up to 16 custom families can be registered per material manager, with source bounded to 64 KiB per definition. Family IDs are stable for the application's lifetime. There is no hot reload/unregister API: use a new bounded family name for a different definition and dispose the application to release its pipeline ownership.

Shader compilation and bounded pipeline variants are prepared during registration/setup, not draw encoding. Compatible custom families share layouts/frame bind groups; shader modules and pipelines use the existing caches. Opaque sorting and instancing include family identity. Mixed shader families can add batches/pipeline switches; many materials sharing one shader/mesh can still be instanced normally.

PBR retains its existing 80-byte GPU material ABI. The custom GPU parameter buffer is allocated only when a custom family is prepared (128 KiB at the default 2,048-material capacity). CPU material state retains the parameter table and family IDs for recovery. Queue/batch IDs use 16-bit storage so custom family indices cannot wrap at 255.

Register shaders before gameplay begins, preload textures, reuse parameter arrays and avoid unnecessary family/material diversity. Your WGSL's texture sampling, loops and lighting work determine its GPU cost; arbitrary custom shading cannot guarantee a universal performance improvement.

## Validation

```sh
pnpm run validate:materials
pnpm run validate
pnpm run benchmark:gpu
```

The material scenario runs against the production build. It checks registration failure/deduplication, analytic color, alpha modes, direct/indirect drawing, depth, HDR/environment setup, textured/skinned/morphed PBR-equivalent references, shadows, recovery, disposal and warm resource stability. It also measures 1,000 instanced objects with PBR, equivalent custom PBR and unlit shading; GPU waits/readbacks occur only in this diagnostic script. Results are written to `artifacts/material-shaders.json`.
