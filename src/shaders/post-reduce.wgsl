struct PostSettings {
  a: vec4<f32>,
  b: vec4<f32>
};
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var outputImage: texture_storage_2d<OUTPUT_FORMAT, write>;
@group(0) @binding(2) var<uniform> options: PostSettings;
// Transforms source radiance into thresholded bloom or log-luminance/count reduction values for this pipeline variant.
fn extract(color: vec4<f32>) -> vec4<f32> {
  // EXTRACT_VALUE
}

// Reduces covered scene pixels into the first bloom/luminance level, handling odd dimensions.
@compute @workgroup_size(8, 8) fn first(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= textureDimensions(outputImage))) {
    return;
  }
  let size = vec2<i32>(textureDimensions(source));
  var sum = vec4<f32>(0.0);
  var count = 0.0;
  for (var y = 0; y < 2; y++) {
    for (var x = 0; x < 2; x++) {
      let p = vec2<i32>(id.xy) * 2 + vec2<i32>(x, y);
      if (all(p < size)) {
        sum += extract(textureLoad(source, p, 0));
        count += 1.0;
      }
    }
  }
  // STORE_FIRST
}

// Combines preceding reduction texels into the next bounded mip/level.
@compute @workgroup_size(8, 8) fn reduce(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= textureDimensions(outputImage))) {
    return;
  }
  let size = vec2<i32>(textureDimensions(source));
  var sum = vec4<f32>(0.0);
  var count = 0.0;
  for (var y = 0; y < 2; y++) {
    for (var x = 0; x < 2; x++) {
      let p = vec2<i32>(id.xy) * 2 + vec2<i32>(x, y);
      if (all(p < size)) {
        sum += textureLoad(source, p, 0);
        count += 1.0;
      }
    }
  }
  // STORE_REDUCE
}
