@compute @workgroup_size(64) fn cull(@builtin(global_invocation_id) invocation:vec3<u32>){
 let id=invocation.x;if(id>=params.count){return;}
 let object=objects[id];let m=frame.viewProjection;
 let rows=array<vec4<f32>,4>(vec4<f32>(m[0].x,m[1].x,m[2].x,m[3].x),vec4<f32>(m[0].y,m[1].y,m[2].y,m[3].y),vec4<f32>(m[0].z,m[1].z,m[2].z,m[3].z),vec4<f32>(m[0].w,m[1].w,m[2].w,m[3].w));
 var accepted=1u;
 for(var plane=0u;plane<6u;plane++){
  var p=rows[3]+select(1.0,-1.0,plane%2u==1u)*rows[plane/2u];if(plane==4u){p=rows[2];}
  let length=length(p.xyz);let distance=dot(p.xyz,object.boundsCenter)+p.w+object.boundsRadius*length;
  if(distance < -1e-5*length){accepted=0u;break;}
 }
 visible[id]=accepted;
}
