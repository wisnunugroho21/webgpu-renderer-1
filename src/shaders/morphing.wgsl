fn applyMorphTarget(base:LocalVertex,delta:u32,weight:f32)->LocalVertex{
 return LocalVertex(base.position+morphPositions[delta].xyz*weight,base.normal+morphNormals[delta].xyz*weight,vec4<f32>(base.tangent.xyz+morphTangents[delta].xyz*weight,base.tangent.w));
}
fn morphVertex(base:LocalVertex,info:Instance,vertex:u32)->LocalVertex{
 var result=base;
 // An instance-uniform flag avoids per-target branches for fully active weights.
 if((info.flags&0x20000u)!=0u){
  for(var targetIndex=0u;targetIndex<info.morphTargetCount;targetIndex++){
   let delta=info.morphDeltaOffset+targetIndex*info.morphVertexCount+vertex;
   result=applyMorphTarget(result,delta,morphWeights[info.morphWeightOffset+targetIndex]);
  }
 }else{
  for(var targetIndex=0u;targetIndex<info.morphTargetCount;targetIndex++){
   let weight=morphWeights[info.morphWeightOffset+targetIndex];if(weight==0.0){continue;}
   let delta=info.morphDeltaOffset+targetIndex*info.morphVertexCount+vertex;
   result=applyMorphTarget(result,delta,weight);
  }
 }
 return result;
}
