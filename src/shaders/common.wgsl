struct LocalVertex {position:vec3<f32>,normal:vec3<f32>,tangent:vec4<f32>}
fn safeNormalize(v:vec3<f32>)->vec3<f32>{return v*inverseSqrt(max(dot(v,v),1e-20));}
// One entry point for every geometry pass: base -> morph -> skin -> model.
fn deformVertex(base:LocalVertex,info:Instance,vertex:u32,jointIndices:vec4<u32>,weights:vec4<f32>,model:mat4x4<f32>)->LocalVertex{
 let morphed=morphVertex(base,info,vertex);
 let composite=model*skinningMatrix(info,jointIndices,weights);
 let a=composite[0].xyz;let b=composite[1].xyz;let c=composite[2].xyz;
 let determinant=dot(a,cross(b,c));let sign=select(1.0,-1.0,determinant<0.0);
 let cofactor=mat3x3<f32>(cross(b,c),cross(c,a),cross(a,b));
 return LocalVertex((composite*vec4<f32>(morphed.position,1)).xyz,safeNormalize(cofactor*morphed.normal)*sign,vec4<f32>(safeNormalize(mat3x3<f32>(a,b,c)*morphed.tangent.xyz),morphed.tangent.w*sign));
}
