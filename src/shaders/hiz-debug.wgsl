// Diagnostic fullscreen view of a selected Hi-Z mip; disabled during ordinary rendering.
@group(0) @binding(0) var depthMip: texture_2d<f32>;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>
}

// Emits the oversized fullscreen triangle from vertex IDs without a vertex buffer.
@vertex fn vs(@builtin(vertex_index) vertex: u32) -> Output {
  let p = array<vec2<f32>, 3>(vec2<f32>(- 1, - 1), vec2<f32>(3, - 1), vec2<f32>(- 1, 3));
  var out: Output;
  out.position = vec4<f32>(p[vertex], 0, 1);
  out.uv = vec2<f32>(p[vertex].x * .5 + .5, .5 - p[vertex].y * .5);
  return out;
}

// Visualizes the selected Hi-Z depth mip for diagnostics.
@fragment fn fs(input: Output) -> @location(0) vec4<f32> {
  let size = textureDimensions(depthMip);
  let pixel = clamp(vec2<i32>(input.uv * vec2<f32>(size)), vec2<i32>(0), vec2<i32>(size) - 1);
  let depth = textureLoad(depthMip, pixel, 0).r;
  return vec4<f32>(vec3<f32>(depth), 1);
}
