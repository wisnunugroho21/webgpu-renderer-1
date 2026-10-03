struct GPUObject {boundsCenter:vec3<f32>,boundsRadius:f32,meshId:u32,materialId:u32,transformId:u32,flags:u32}
struct VisibilityParams {count:u32,padding0:u32,padding1:u32,padding2:u32}
@group(0) @binding(0) var<uniform> frame:Frame;
@group(0) @binding(1) var<storage,read> objects:array<GPUObject>;
@group(0) @binding(2) var<storage,read_write> visible:array<u32>;
@group(0) @binding(3) var<uniform> params:VisibilityParams;
