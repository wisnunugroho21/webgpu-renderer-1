// Split-sum GGX IBL. Diffuse is cosine-convolved radiance (irradiance / PI).
// The supplied mip chain is prefiltered by roughness; ordinary image mips are insufficient.
struct EnvironmentParameters {
  intensity: f32,
  maxLod: f32,
  cosine: f32,
  sine: f32
}

@group(2) @binding(0) var<uniform> environment: EnvironmentParameters;
@group(2) @binding(1) var diffuseEnvironment: texture_cube<f32>;
@group(2) @binding(2) var specularEnvironment: texture_cube<f32>;
@group(2) @binding(3) var environmentBRDF: texture_2d<f32>;
@group(2) @binding(4) var environmentSampler: sampler;
// Rotates the environment lookup direction around world Y using retained sine/cosine parameters.
fn environmentDirection(direction: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(environment.cosine * direction.x + environment.sine * direction.z, direction.y, - environment.sine * direction.x + environment.cosine * direction.z);
}

// Combines cosine-convolved diffuse and split-sum GGX specular environment light, attenuating only indirect light by AO.
fn ambientLighting(base: vec3<f32>, metallic: f32, roughness: f32, n: vec3<f32>, v: vec3<f32>, ao: f32) -> vec3<f32> {
  let nv = clamp(dot(n, v), 0.0, 1.0);
  let f0 = mix(vec3<f32>(0.04), base, metallic);
  let fresnel = f0 + (max(vec3<f32>(1.0 - roughness), f0) - f0) * pow(1.0 - nv, 5.0);
  let diffuse = textureSampleLevel(diffuseEnvironment, environmentSampler, environmentDirection(n), 0.0).rgb;
  let reflection = environmentDirection(reflect(- v, n));
  let specular = textureSampleLevel(specularEnvironment, environmentSampler, reflection, roughness * environment.maxLod).rgb;
  let brdf = textureSampleLevel(environmentBRDF, environmentSampler, vec2<f32>(nv, roughness), 0.0).rg;
  // AO attenuates indirect light; it never shadows direct lights or emissive surfaces.
  return((vec3<f32>(1.0) - fresnel) * (1.0 - metallic) * base * diffuse + specular * (f0 * brdf.x + brdf.y)) * environment.intensity * ao;
}
