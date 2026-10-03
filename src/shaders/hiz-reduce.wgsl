@group(0) @binding(0) var sourceMip:texture_2d<f32>;
@group(0) @binding(1) var destination:texture_storage_2d<r32float,write>;
// Standard Z: maximum (farthest) depth is conservative, including background 1.
@compute @workgroup_size(8,8) fn reduceDepth(@builtin(global_invocation_id) id:vec3<u32>){
 let size=textureDimensions(destination);if(any(id.xy>=size)){return;}
 let sourceSize=textureDimensions(sourceMip);let lo=id.xy*sourceSize/size;let hi=((id.xy+1u)*sourceSize+size-1u)/size;
 var maximum=0.0;
 for(var y=lo.y;y<hi.y;y++){for(var x=lo.x;x<hi.x;x++){maximum=max(maximum,textureLoad(sourceMip,vec2<i32>(i32(x),i32(y)),0).r);}}
 textureStore(destination,id.xy,vec4<f32>(maximum));
}
