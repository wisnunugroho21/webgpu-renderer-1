// Compact visible object IDs into bounded shared storage before indirect draw generation.
struct Params {
  count: u32,
  padding0: u32,
  padding1: u32,
  padding2: u32
}

struct Counter {
  count: atomic<u32>,
  overflow: atomic<u32>,
  padding0: u32,
  padding1: u32
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> visibility: array<u32>;
@group(0) @binding(2) var<storage, read_write> visibleInstances: array<u32>;
@group(0) @binding(3) var<storage, read_write> counter: Counter;
// Appends visible object IDs into bounded GPU storage and records overflow conservatively.
@compute @workgroup_size(64) fn compact(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id >= params.count || visibility[id] == 0u) {
    return;
  }
  let destination = atomicAdd(& counter.count, 1u);
  if (destination < arrayLength(& visibleInstances)) {
    visibleInstances[destination] = id;
  } else {
    atomicAdd(& counter.overflow, 1u);
  }
}
