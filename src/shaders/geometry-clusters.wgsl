// Optional static cluster culling: transform local AABBs conservatively and emit indexed arguments.
// Unsupported, deforming, transparent, and overflowing batches retain the ordinary path.
struct Cluster {
  low: vec4f,
  high: vec4f,
  draw: vec4u
}

struct Frame {
  vp: mat4x4f,
  count: u32,
  cull: u32,
  pad: vec2u
}

struct Args {
  indexCount: u32,
  instanceCount: u32,
  firstIndex: u32,
  baseVertex: u32,
  firstInstance: u32
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> clusters: array<Cluster>;
@group(0) @binding(2) var<storage, read_write> arguments: array<Args>;
@group(0) @binding(3) var<storage, read> matrices: array<mat4x4f>;
@group(0) @binding(4) var<storage, read> instances: array<u32>;
fn visible(low: vec3f, high: vec3f, model: mat4x4f) -> bool {
  let center = (low + high) * 0.5;
  let extent = (high - low) * 0.5;
  let worldCenter = (model * vec4f(center, 1)).xyz;
  let worldExtent = abs(model[0].xyz) * extent.x + abs(model[1].xyz) * extent.y + abs(model[2].xyz) * extent.z;
  let m = frame.vp;
  let x = vec4f(m[0].x, m[1].x, m[2].x, m[3].x);
  let y = vec4f(m[0].y, m[1].y, m[2].y, m[3].y);
  let z = vec4f(m[0].z, m[1].z, m[2].z, m[3].z);
  let w = vec4f(m[0].w, m[1].w, m[2].w, m[3].w);
  let planes = array<vec4f, 6>(w + x, w - x, w + y, w - y, z, w - z);
  for (var p = 0u; p < 6u; p++) {
    let plane = planes[p];
    let projected = dot(plane.xyz, worldCenter);
    let support = dot(abs(plane.xyz), worldExtent);
    // Relative error margin keeps tangencies, huge coordinates, reflection and shear conservative.
    let margin = 0.00001 * (dot(abs(plane.xyz), abs(worldCenter)) + abs(plane.w) + support + 1.0);
    if (projected + plane.w + support < - margin) {
      return false;
    }
  }
  return true;
}

@compute @workgroup_size(64) fn cull(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= frame.count) {
    return;
  }
  let c = clusters[id.x];
  var keep = frame.cull == 0u;
  // A cluster batch is retained if ANY instance intersects: never remove a visible instance.
  for (var i = 0u; i < c.draw.z && ! keep; i++) {
    let transform = instances[(c.draw.w + i) * 12u];
    keep = visible(c.low.xyz, c.high.xyz, matrices[transform]);
  }
  arguments[id.x] = Args(c.draw.x, select(0u, c.draw.z, keep), c.draw.y, 0u, c.draw.w);
}
