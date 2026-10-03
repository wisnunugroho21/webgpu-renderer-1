struct ShadowPass {viewProjection:mat4x4<f32>}
@group(2) @binding(0) var<uniform> shadowPass:ShadowPass;
@group(1) @binding(0) var baseMap:texture_2d<f32>;
@group(1) @binding(1) var baseSampler:sampler;
struct ShadowOutput {@builtin(position) position:vec4<f32>,@location(0) color:vec4<f32>,@location(1) @interpolate(flat) materialId:u32,@location(2) uv0:vec2<f32>,@location(3) uv1:vec2<f32>}
@vertex fn shadowVS(@location(0) p:vec3<f32>,@location(1) color:vec4<f32>,@location(2) normal:vec3<f32>,@location(3) uv0:vec2<f32>,@location(4) tangent:vec4<f32>,@location(5) uv1:vec2<f32>,@location(6) jointIndices:vec4<u32>,@location(7) weights:vec4<f32>,@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instance:u32)->ShadowOutput{
 let info=instances[instance];let vertex=deformVertex(LocalVertex(p,normal,tangent),info,vertexIndex,jointIndices,weights,transforms[info.transformIndex]);
 var out:ShadowOutput;out.position=shadowPass.viewProjection*vec4<f32>(vertex.position,1);out.color=color;out.materialId=info.materialIndex;out.uv0=uv0;out.uv1=uv1;return out;
}
@fragment fn shadowFS(input:ShadowOutput){
 let m=materials[input.materialId];let uv=select(input.uv0,input.uv1,m.uv.x==1.0);
 let alpha=m.baseColor.a*input.color.a*textureSample(baseMap,baseSampler,uv).a;
 if(m.surface.z==1.0 && alpha<m.surface.w){discard;}
}
