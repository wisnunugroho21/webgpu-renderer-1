// Choose authored mesh levels from projected size with hysteresis.
// Selection runs after visibility and before compaction/indirect argument generation.
struct LODObject {
  group: u32,
  entity: u32,
  baseMesh: u32,
  padding: u32
}

struct LODGroup {
  count: u32,
  hysteresis: f32,
  padding0: u32,
  padding1: u32,
  thresholds: array<f32,
  8>,
  meshes: array<u32,
  8>
}

struct History {
  group: u32,
  level: i32,
  valid: u32,
  padding: u32
}

@group(0) @binding(4) var<storage, read> lodObjects: array<LODObject>;
@group(0) @binding(5) var<storage, read> lodGroups: array<LODGroup>;
@group(0) @binding(6) var<storage, read_write> history: array<History>;
@group(0) @binding(7) var<storage, read_write> selections: array<i32>;
@group(0) @binding(8) var<storage, read_write> selectedMeshes: array<u32>;
@group(0) @binding(9) var<storage, read_write> distribution: array<atomic<u32>, 8>;
// Chooses a compatible authored mesh from projected pixel size while retaining LOD hysteresis state.
@compute @workgroup_size(64) fn selectLOD(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let id = invocation.x;
  if (id >= params.count) {
    return;
  }
  let info = lodObjects[id];
  selectedMeshes[id] = info.baseMesh;
  if (visible[id] == 0u) {
    selections[id] = - 3;
    return;
  }
  if (info.group == 0xffffffffu) {
    selections[id] = - 2;
    history[info.entity].valid = 0u;
    return;
  }
  let group = lodGroups[info.group];
  let object = objects[id];
  let depth = - (frame.view * vec4<f32>(object.boundsCenter, 1)).z;
  var pixels = 1e30;
  if ((u32(frame.lighting.z) & 2u) != 0u) {
    pixels = object.boundsRadius * frame.viewport.w * frame.viewport.y;
  } else if (depth > object.boundsRadius) {
    pixels = object.boundsRadius * frame.viewport.w * frame.viewport.y / (depth - object.boundsRadius);
  }
  var level = - 1;
  for (var index = 0u; index < group.count; index++) {
    if (pixels >= group.thresholds[index]) {
      level = i32(index);
      break;
    }
  }
  let old = history[info.entity];
  let prior = select(- 2, old.level, old.valid != 0u && old.group == info.group);
  if (prior != - 2 && prior != level) {
    if (prior == - 1) {
      if (level >= 0 && pixels < group.thresholds[group.count - 1u] * (1.0 + group.hysteresis)) {
        level = - 1;
      }
    } else if (level == - 1) {
      if (pixels > group.thresholds[u32(prior)] * (1.0 - group.hysteresis)) {
        level = prior;
      }
    } else if (level < prior) {
      if (pixels < group.thresholds[u32(level)] * (1.0 + group.hysteresis)) {
        level = prior;
      }
    } else if (pixels > group.thresholds[u32(prior)] * (1.0 - group.hysteresis)) {
      level = prior;
    }
  }
  history[info.entity] = History(info.group, level, 1u, 0u);
  selections[id] = level;
  if (level < 0) {
    visible[id] = 0u;
    return;
  }
  selectedMeshes[id] = group.meshes[u32(level)];
  atomicAdd(& distribution[u32(level)], 1u);
}
