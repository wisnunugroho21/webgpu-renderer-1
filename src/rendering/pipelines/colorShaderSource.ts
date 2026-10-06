import transmissionShader from "../../shaders/transmission.wgsl?raw";
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
}
// No environment means no reflected coat radiance; retain diffuse ambient under its Fresnel layer.
fn authoredAmbientLighting(base: vec3<f32>, metallic: f32, roughness: f32, n: vec3<f32>, v: vec3<f32>, ao: f32, lobes: AuthoredLobes) -> vec3<f32> {
  let coatF = lobes.coatWeight * (0.04 + 0.96 * pow(1.0 - clamp(dot(lobes.coatNormal, v), 0.0, 1.0), 5.0));
  return ambientLighting(base, metallic, roughness, n, v, ao) * (1.0 - coatF);
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
  input: Pick<
    ColorResourcesInput,
    "shader" | "environmentLayout" | "transmission"
  >,
): string {
  const ambient = input.environmentLayout ? environmentShader : defaultAmbient;
  let pbr = pbrShader;
  if (input.transmission)
    pbr = pbr
      .replace("// VOLUME_VARYING", "@location(7) volumeScale:vec3<f32>,")
      .replace(
        "// VOLUME_SCALE",
        "let model=transforms[info.transformIndex];out.volumeScale=vec3<f32>(length(model[0].xyz),length(model[1].xyz),length(model[2].xyz));",
      )
      .replace("// VOLUME_FACTORS", "let volume=volumeFactors(m,input);")
      .replace(
        "// TRANSMISSION_COLOR",
        `
    if m.transmission.x>0.0 {
      let reflectionLobes=AuthoredLobes(lobes.f0,lobes.f90,lobes.coatNormal,lobes.coatRoughness,lobes.coatWeight,true);
      let reflected=authoredDirectLighting(vec3<f32>(0),metallic,roughness,n,v,input.world,input.position.xy,reflectionLobes)+authoredAmbientLighting(vec3<f32>(0),metallic,roughness,n,v,ao,reflectionLobes)+emissive*(1.0-coatF);
      let fresnel=lobes.f0+(vec3<f32>(1.0)-lobes.f0)*pow(1.0-clamp(dot(n,v),0.0,1.0),5.0);
      result=transmissionColor(m,input,volume,n,v,metallic,roughness,fresnel,coatF,result,reflected,base.rgb);
    }`,
      );
  const transmission = input.transmission ? transmissionShader : "";
  if (!input.shader)
    return (
      sharedShader.replace(pbrShader, pbr) +
      "\n" +
      ambient +
      "\n" +
      transmission
    );
  const prefix = pbr.slice(0, pbr.indexOf("  var result ="));
  const customFragment = `
  var viewDirection = safeNormalize(frame.eye.xyz - input.world);
  if ((u32(frame.lighting.z) & 2u) != 0u) {
    viewDirection = safeNormalize(vec3<f32>(frame.view[0].z, frame.view[1].z, frame.view[2].z));
  }
  let surface = MaterialSurface(base, emissive, clamp(m.surface.x * mr.b, 0.0, 1.0), n,
    clamp(m.surface.y * mr.g, 0.045, 1.0), input.world, ao, viewDirection,
    input.materialId, input.uv0, input.uv1, input.position.xy);
  var result = shadeMaterial(surface, materialShaderParameters[input.materialId]);
  ${
    input.transmission
      ? `
  let ratio=(m.authored.x-1.0)/(m.authored.x+1.0);let f0=select(ratio*ratio,1.0,m.authored.x==0.0)*m.authored.y;
  let fresnel=vec3<f32>(f0+(1.0-f0)*pow(1.0-clamp(dot(n,viewDirection),0.0,1.0),5.0));
  result=transmissionColor(m,input,volume,n,viewDirection,surface.metallic,surface.roughness,fresnel,0.0,result,result*fresnel,base.rgb);`
      : ""
  }
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
    transmission,
  ].join("\n");
}
