import surfaceShader from "../../shaders/material-surface.wgsl?raw";
import environmentShader from "../../shaders/environment.wgsl?raw";
import shadowShader from "../../shaders/shadows.wgsl?raw";
import geometryShader from "../../shaders/geometry.wgsl?raw";
import frameShader from "../../shaders/frame.wgsl?raw";
import lightingShader from "../../shaders/lighting.wgsl?raw";
import pbrShader from "../../shaders/pbr.wgsl?raw";
import commonShader from "../../shaders/common.wgsl?raw";
import morphShader from "../../shaders/morphing.wgsl?raw";
import skinShader from "../../shaders/skinning.wgsl?raw";
import type { ColorResourcesInput } from "./ColorResources";

const defaultAmbient = `
// Returns a 3% diffuse ambient term attenuated by AO when no environment is installed.
fn ambientLighting(base: vec3<f32>, metallic: f32, roughness: f32, n: vec3<f32>, v: vec3<f32>, ao: f32) -> vec3<f32> {
  return base * (1.0 - metallic) * 0.03 * ao;
}`;
const sharedShader = [
  frameShader,
  geometryShader,
  commonShader,
  morphShader,
  skinShader,
  shadowShader,
  lightingShader,
  pbrShader,
].join("\n");
/** Assembles a surface-only family while retaining vertex entry points, texture roles and alpha coverage. */
export function colorShaderSource(
  input: Pick<ColorResourcesInput, "shader" | "environmentLayout">,
): string {
  const ambient = input.environmentLayout ? environmentShader : defaultAmbient;
  if (!input.shader) return sharedShader + "\n" + ambient;
  const prefix = pbrShader.slice(0, pbrShader.indexOf("  var result ="));
  const customFragment = `
  var viewDirection = safeNormalize(frame.eye.xyz - input.world);
  if ((u32(frame.lighting.z) & 2u) != 0u) {
    viewDirection = safeNormalize(vec3<f32>(frame.view[0].z, frame.view[1].z, frame.view[2].z));
  }
  let surface = MaterialSurface(base, emissive, clamp(m.surface.x * mr.b, 0.0, 1.0), n,
    clamp(m.surface.y * mr.g, 0.045, 1.0), input.world, ao, viewDirection,
    input.materialId, input.uv0, input.uv1, input.position.xy);
  let result = shadeMaterial(surface, materialShaderParameters[input.materialId]);
  return vec4<f32>(result, select(1.0, base.a, m.surface.z == 2.0));
}`;
  return [
    frameShader,
    geometryShader,
    commonShader,
    morphShader,
    skinShader,
    shadowShader,
    lightingShader,
    surfaceShader,
    prefix + customFragment,
    ambient,
    input.shader.source,
  ].join("\n");
}
