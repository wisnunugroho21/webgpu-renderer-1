// Build indexed indirect arguments and instance records for precomputed CPU batch groups.
// The CPU submits groups without reading visibility back from the GPU.
struct Params {
  objects: u32,
  batches: u32,
  padding0: u32,
  padding1: u32
}

struct Batch {
  indexCount: u32,
  capacity: u32,
  firstInstance: u32,
  transparent: u32,
  morphDeltaOffset: u32,
  morphVertexCount: u32,
  meshId: u32,
  padding: u32
}

struct ObjectDraw {
  instance: u32,
  rank: u32,
  padding0: u32,
  padding1: u32,
  batches: array<u32,
  8>
}

struct VisibleRecord {
  instance: u32,
  morphDeltaOffset: u32,
  morphVertexCount: u32,
  meshId: u32
}

struct Counter {
  count: u32,
  overflow: u32,
  padding0: u32,
  padding1: u32
}

struct DrawIndexedArgs {
  indexCount: u32,
  instanceCount: atomic<u32>,
  firstIndex: u32,
  baseVertex: i32,
  firstInstance: u32
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> batches: array<Batch>;
@group(0) @binding(2) var<storage, read> mapping: array<ObjectDraw>;
@group(0) @binding(3) var<storage, read> counter: Counter;
@group(0) @binding(4) var<storage, read> compacted: array<u32>;
@group(0) @binding(5) var<storage, read_write> arguments: array<DrawIndexedArgs>;
@group(0) @binding(6) var<storage, read_write> visibleRecords: array<VisibleRecord>;
@group(0) @binding(7) var<storage, read> lodSelections: array<i32>;
// Resets indexed indirect counts and seeds transparent visible-record slots in stable CPU order.
@compute @workgroup_size(64) fn initialize(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id < params.batches) {
    let batch = batches[id];
    arguments[id].indexCount = batch.indexCount;
    atomicStore(& arguments[id].instanceCount, select(0u, batch.capacity, batch.transparent == 1u));
    arguments[id].firstIndex = 0u;
    arguments[id].baseVertex = 0;
    arguments[id].firstInstance = batch.firstInstance;
  }
  if (id < params.objects) {
    let draw = mapping[id];
    for (var level = 0u; level < 8u; level++) {
      let batchId = draw.batches[level];
      if (batchId == 0xffffffffu) {
        break;
      }
      let batch = batches[batchId];
      if (batch.transparent == 1u) {
        visibleRecords[batch.firstInstance + draw.rank] = VisibleRecord(draw.instance | 0x80000000u, batch.morphDeltaOffset, batch.morphVertexCount, batch.meshId);
      }
    }
  }
}

// Appends compacted visible objects to opaque argument ranges while preserving transparent ranks and LOD layout.
@compute @workgroup_size(64) fn buildArguments(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id >= counter.count) {
    return;
  }
  let object = compacted[id];
  let draw = mapping[object];
  let level = lodSelections[object];
  let batchId = draw.batches[u32(max(level, 0))];
  if (batchId == 0xffffffffu) {
    return;
  }
  let batch = batches[batchId];
  var destination = draw.rank;
  if (batch.transparent == 0u) {
    destination = atomicAdd(& arguments[batchId].instanceCount, 1u);
  }
  if (destination < batch.capacity) {
    visibleRecords[batch.firstInstance + destination] = VisibleRecord(draw.instance, batch.morphDeltaOffset, batch.morphVertexCount, batch.meshId);
  }
}
