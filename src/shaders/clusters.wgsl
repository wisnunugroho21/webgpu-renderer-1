// Build screen-tile/depth-slice light lists in fixed storage.
// Record overflow explicitly; the fragment shader falls back to all lights.
struct ClusterHeader {
  offset: u32,
  count: atomic<u32>
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(9) var<storage, read> lights: array<Light>;
@group(1) @binding(0) var<storage, read_write> counts: array<ClusterHeader>;
@group(1) @binding(1) var<storage, read_write> indices: array<u32>;
// Builds one bounded screen/depth light list; overflow metadata makes fragment shading fall back to all lights.
@compute @workgroup_size(64) fn cs(@builtin(workgroup_id) cell: vec3<u32>, @builtin(local_invocation_index) lane: u32) {
  let tiles = vec2<u32>(frame.cluster.xy);
  let index = (cell.z * tiles.y + cell.y) * tiles.x + cell.x;
  if (lane == 0u) {
    counts[index].offset = index * u32(frame.lighting.w);
    atomicStore(& counts[index].count, 0u);
  }
  storageBarrier();
  let loPixel = vec2<f32>(cell.xy) * frame.cluster.z;
  let hiPixel = min(loPixel + frame.cluster.z, frame.viewport.xy);
  let loNDC = vec2<f32>(loPixel.x / frame.viewport.x * 2.0 - 1.0, 1.0 - hiPixel.y / frame.viewport.y * 2.0);
  let hiNDC = vec2<f32>(hiPixel.x / frame.viewport.x * 2.0 - 1.0, 1.0 - loPixel.y / frame.viewport.y * 2.0);
  let perspectiveNear = max(frame.lighting.x, 1e-6);
  var near = perspectiveNear * pow(frame.lighting.y / perspectiveNear, f32(cell.z) / frame.cluster.w);
  var far = perspectiveNear * pow(frame.lighting.y / perspectiveNear, f32(cell.z + 1u) / frame.cluster.w);
  var lo = min(loNDC * near / frame.viewport.zw, loNDC * far / frame.viewport.zw);
  var hi = max(hiNDC * near / frame.viewport.zw, hiNDC * far / frame.viewport.zw);
  if ((u32(frame.lighting.z) & 2u) != 0u) {
    near = mix(frame.lighting.x, frame.lighting.y, f32(cell.z) / frame.cluster.w);
    far = mix(frame.lighting.x, frame.lighting.y, f32(cell.z + 1u) / frame.cluster.w);
    lo = loNDC / frame.viewport.zw;
    hi = hiNDC / frame.viewport.zw;
  }
  let minimum = vec3<f32>(lo, near);
  let maximum = vec3<f32>(hi, far);
  for (var i = lane; i < u32(frame.eye.w); i += 64u) {
    let light = lights[i];
    var include = light.direction.w == 0.0 || light.position.w == 0.0;
    if (! include) {
      let p = (frame.view * vec4<f32>(light.position.xyz, 1)).xyz;
      let center = vec3<f32>(p.xy, - p.z);
      let closest = clamp(center, minimum, maximum);
      let distance = center - closest;
      let radius = light.position.w + 1e-4 * max(1.0, light.position.w);
      include = dot(distance, distance) <= radius * radius;
    }
    if (include) {
      let slot = atomicAdd(& counts[index].count, 1u);
      if (slot < u32(frame.lighting.w)) {
        indices[index * u32(frame.lighting.w) + slot] = i;
      }
    }
  }
}
