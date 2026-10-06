import geometry from "../../shaders/geometry.wgsl?raw";
import skinning from "../../shaders/skinning.wgsl?raw";
/** Reuse the material ABI, UV transforms and joint-weight rules while packing temporal poses into two buffers. */
export function createMotionShader(): string {
  const structs = geometry.slice(0, geometry.indexOf("@group(0)"));
  const uv = geometry.slice(geometry.indexOf("// Select UV0"));
  const skin = skinning
    .replace("fn skinningMatrix(", "fn motionSkin(")
    .replace("vertex: u32)", "vertex: u32, previous: bool)")
    .replace(/joints\[([^\]]+)\]/g, "motionJoint($1,previous)");
  return `${structs}
struct Object {model:mat4x4<f32>,info:Instance}
struct MotionFrame {current:mat4x4<f32>,previous:mat4x4<f32>,offsets:vec4<u32>}
@group(0) @binding(0) var<uniform> frame:MotionFrame;
@group(0) @binding(1) var<storage,read> objects:array<Object>;
@group(0) @binding(2) var<storage,read> materials:array<Material>;
@group(0) @binding(3) var<storage,read> history:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read> joints:array<mat4x4<f32>>;
@group(0) @binding(5) var<storage,read> morphWeights:array<f32>;
@group(0) @binding(6) var<storage,read> morphPositions:array<vec4<f32>>;
@group(0) @binding(7) var<storage,read> morphTangents:array<vec4<f32>>;
@group(1) @binding(0) var baseMap:texture_2d<f32>;
@group(1) @binding(1) var baseSampler:sampler;
${uv}
// Read current palette or the retained previous shared palette without another storage binding.
fn motionJoint(index:u32,previous:bool)->mat4x4<f32> {
  if previous {let o=frame.offsets.x+index*4u;return mat4x4<f32>(history[o],history[o+1u],history[o+2u],history[o+3u]);}
  return joints[index];
}
${skin}
// Preserve signed target-major morph accumulation before skinning in both frames.
fn motionPosition(p:vec3<f32>,info:Instance,vertex:u32,indices:vec4<u32>,weights:vec4<f32>,model:mat4x4<f32>,previous:bool)->vec4<f32> {
  var position=p;
  for(var t=0u;t<info.morphTargetCount;t++) {
    let index=info.morphWeightOffset+t;
    var weight=0.0;
    if previous {weight=history[frame.offsets.y+index/4u][index%4u];} else {weight=morphWeights[index];}
    if weight!=0.0 {position+=morphPositions[info.morphDeltaOffset+t*info.morphVertexCount+vertex].xyz*weight;}
  }
  return model*motionSkin(info,indices,weights,vertex,previous)*vec4<f32>(position,1);
}
struct Output {@builtin(position) position:vec4<f32>,@location(0) current:vec4<f32>,@location(1) prior:vec4<f32>,@location(2) color:vec4<f32>,@location(3) uv0:vec2<f32>,@location(4) uv1:vec2<f32>,@location(5) @interpolate(flat) material:u32,@location(6) @interpolate(flat) valid:u32}
// Project the same deformed vertex in both frames; flat validity rejects newly introduced geometry.
@vertex fn vs(@location(0) p:vec3<f32>,@location(1) color:vec4<f32>,@location(3) uv0:vec2<f32>,@location(5) uv1:vec2<f32>,@location(6) indices:vec4<u32>,@location(7) weights:vec4<f32>,@builtin(vertex_index) vertex:u32,@builtin(instance_index) index:u32)->Output {
  let object=objects[index];let offset=index*7u;
  let oldModel=mat4x4<f32>(history[offset],history[offset+1u],history[offset+2u],history[offset+3u]);
  let a=bitcast<vec4<u32>>(history[offset+4u]);let b=bitcast<vec4<u32>>(history[offset+5u]);let c=bitcast<vec4<u32>>(history[offset+6u]);
  let old=Instance(a.x,a.y,a.z,a.w,b.x,b.y,b.z,b.w,c.x,c.y,c.z,c.w);
  var out:Output;
  out.current=frame.current*motionPosition(p,object.info,vertex,indices,weights,object.model,false);
  out.prior=frame.previous*motionPosition(p,old,vertex,indices,weights,oldModel,true);
  out.position=out.current;out.color=color;out.uv0=uv0;out.uv1=uv1;out.material=object.info.materialIndex;out.valid=object.info.padding;
  return out;
}
// Respect authored alpha masks and store screen velocity plus prior depth for disocclusion tests.
@fragment fn fs(input:Output)->@location(0) vec4<f32> {
  let m=materials[input.material];let alpha=m.baseColor.a*input.color.a*textureSample(baseMap,baseSampler,materialUV(m,input.uv0,input.uv1,0u)).a;
  if m.surface.z==1.0 && alpha<m.surface.w {discard;}
  if input.valid==0u || input.prior.w<=0.0 {return vec4<f32>(0);}
  let current=input.current.xyz/input.current.w;let previous=input.prior.xyz/input.prior.w;
  return vec4<f32>((current.xy-previous.xy)*vec2<f32>(0.5,-0.5),previous.z,1);
}`;
}
