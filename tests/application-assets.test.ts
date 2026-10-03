import { afterEach, expect, it, vi } from "vitest";
import { Application } from "../src/app/Application";
import { GLTFLoader } from "../src/assets/gltf/GLTFLoader";
import { AssetDecoder } from "../src/assets/workers/AssetDecoder";
import { RuntimeAsset } from "../src/assets/gltf/RuntimeAsset";
import { Mat4 } from "../src/math/Mat4";
import { Resources } from "../src/gpu/Resources";
import { MeshManager } from "../src/rendering/MeshManager";
import { MorphDeltaBuffers } from "../src/rendering/MorphDeltaBuffers";
import { MaterialTextures } from "../src/rendering/materials/MaterialTextures";
import { Renderer } from "../src/rendering/Renderer";
import { GPUContext } from "../src/gpu/GPUContext";
import { JSONDocument } from "@gltf-transform/core";
Object.assign(globalThis, {
  GPUBufferUsage: {
    VERTEX: 1,
    INDEX: 2,
    COPY_DST: 4,
    STORAGE: 8,
    COPY_SRC: 16,
  },
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const app = new Application(
    {} as HTMLCanvasElement,
    {} as HTMLOutputElement,
    128,
  );
  const queue = {
    writeBuffer: vi.fn(),
    onSubmittedWorkDone: vi.fn(async () => {}),
  } as unknown as GPUQueue;
  const resources = new Resources({
    createBuffer: (d) => ({ size: d.size, destroy() {} }),
  } as GPUDevice);
  const deltas = new MorphDeltaBuffers(resources, queue, 9),
    meshes = new MeshManager(resources, queue, deltas);
  meshes.register({
    vertex: {} as GPUBuffer,
    index: {} as GPUBuffer,
    indexCount: 0,
    topology: 0,
  });
  const textures = {
    groups: [],
    prepare: vi.fn(async () => []),
    release: vi.fn(async () => {}),
  } as unknown as MaterialTextures;
  app.renderer = {
    meshes,
    textures,
    lodGroups: { entries: [] },
    streaming: { referencesAsset: () => false },
    dispose: () => resources.dispose(),
  } as unknown as Renderer;
  app.gpu = {
    queue,
    disposed: false,
    lost: false,
    dispose: vi.fn(),
  } as unknown as GPUContext;
  const node = (mesh: number, skin: number): RuntimeAsset["nodes"][number] => ({
    name: "node",
    children: new Uint32Array(),
    mesh,
    skin,
    camera: -1,
    position: new Float32Array(3),
    rotation: new Float32Array([0, 0, 0, 1]),
    scale: new Float32Array([1, 1, 1]),
    matrix: Mat4.create(),
    weights: new Float32Array(),
  });
  const asset: RuntimeAsset = {
    nodes: [node(0, 0), node(-1, -1)],
    scenes: [new Uint32Array([0, 1])],
    defaultScene: 0,
    cameras: [],
    materials: [],
    textures: [],
    meshes: [
      {
        name: "triangle",
        weights: new Float32Array([0.2]),
        primitives: [
          {
            attributes: {
              POSITION: new Float32Array(9),
              NORMAL: new Float32Array(9),
              JOINTS_0: new Float32Array(12),
              WEIGHTS_0: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
            },
            indices: new Uint32Array([0, 1, 2]),
            mode: 4,
            material: -1,
            targets: [{ POSITION: new Float32Array(9) }],
          },
        ],
      },
    ],
    skins: [
      {
        joints: new Uint32Array([1]),
        skeleton: 1,
        inverseBindMatrices: Mat4.create(),
      },
    ],
    animations: [
      {
        name: "move",
        channels: [
          {
            node: 0,
            path: "translation",
            interpolation: "LINEAR",
            input: new Float32Array([0, 1]),
            output: new Float32Array([0, 0, 0, 1, 0, 0]),
            elementSize: 3,
          },
        ],
      },
    ],
  };
  vi.spyOn(GLTFLoader.prototype, "fetch").mockResolvedValue({} as JSONDocument);
  vi.spyOn(AssetDecoder.prototype, "decode").mockResolvedValue(asset);
  return { app, asset, resources, deltas, meshes, queue };
}
it("unloads all owned instances, preserves another character, and reuses shared ranges", async () => {
  const f = fixture(),
    baseline = f.resources.stats.buffers,
    available = f.app.materials.available;
  await f.app.loadAsset("a");
  await f.app.loadAsset("a");
  await f.app.loadAsset("b");
  const animator = f.app.animations.animators[2]!,
    skeleton = f.app.skeletons.instances[2]!,
    state = f.app.animations.morphStates[2]!;
  animator.play();
  animator.currentTime = 0.5;
  const offset = skeleton.jointOffset,
    weights = state.weights;
  await f.app.unloadAsset("a");
  expect(f.app.world.count).toBe(5); // bootstrap/light + B's two nodes and primitive
  expect(f.app.animations.animators).toEqual([animator]);
  expect(f.app.skeletons.instances).toEqual([skeleton]);
  expect(f.app.world.skins.instanceId[skeleton.meshEntity]).toBe(0);
  expect(f.app.world.animators.animatorId[skeleton.meshEntity]).toBe(0);
  expect(f.app.animations.morphStates[0]!.weights).toBe(weights);
  expect(skeleton.jointOffset).toBe(offset);
  expect(f.app.renderWorld.count).toBe(2);
  f.app.animations.update(0.1);
  f.app.transformSystem.update(f.app.world.transforms);
  f.app.skeletonSystem.update(f.app.world, f.app.skeletons);
  expect(animator.currentTime).toBeCloseTo(0.6);
  await f.app.loadAsset("a");
  expect(f.app.skeletons.instances[1]!.jointOffset).toBe(0);
  await f.app.unloadAsset("a");
  await f.app.unloadAsset("b");
  expect(f.resources.stats.buffers).toBe(baseline);
  expect(f.deltas.count).toBe(0);
  expect(f.app.materials.available).toBe(available);
  expect(f.app.animations.morphPool.count).toBe(0);
  expect(f.app.skeletons.jointCount).toBe(0);
  expect(f.app.skeletons.assets).toHaveLength(0);
  expect(f.app.world.count).toBe(2);
  expect(f.app.assetLoader.records.size).toBe(0);
  await f.app.dispose();
});
it("vetoes foreign mesh/hierarchy/LOD consumers without removing owned instances", async () => {
  const f = fixture();
  const nodes = await f.app.loadAsset("a");
  const external = f.app.world.create();
  f.app.world.transforms.add(external);
  f.app.world.transforms.setParent(external, nodes[0]!);
  const before = f.app.world.count;
  await expect(f.app.unloadAsset("a")).rejects.toThrow("external entity");
  expect(f.app.world.count).toBe(before);
  expect(f.app.assetLoader.get("a").state).toBe("Ready");
  f.app.world.transforms.setParent(external, -1);
  const meshID = f.app.assetLoader.get("a").uploaded!.meshIds[0]![0]!;
  f.app.world.meshes.set(external, meshID, 0);
  await expect(f.app.unloadAsset("a")).rejects.toThrow("external entity");
  f.app.world.meshes.remove(external);
  f.app.renderer.lodGroups.entries.push({
    meshes: new Uint32Array([meshID]),
    thresholds: new Float32Array([1]),
    hysteresis: 0,
  });
  await expect(f.app.unloadAsset("a")).rejects.toThrow("LOD group");
  f.app.renderer.lodGroups.entries.length = 0;
  await f.app.unloadAsset("a");
  await f.app.dispose();
});
it("rolls back failed instantiation controllers/entities and leaves a retryable shared asset", async () => {
  const f = fixture();
  f.asset.animations[0]!.channels[0]!.output = new Float32Array(2);
  await expect(f.app.loadAsset("a")).rejects.toThrow();
  expect(f.app.world.count).toBe(2);
  expect(f.app.skeletons.instances).toHaveLength(0);
  expect(f.app.skeletons.jointCount).toBe(0);
  expect(f.app.animations.morphPool.count).toBe(0);
  expect(f.app.assetLoader.get("a").references).toBe(0);
  await f.app.unloadAsset("a");
  await f.app.dispose();
});
it("removes consumers before fencing and blocks loading during the asynchronous release", async () => {
  const f = fixture();
  await f.app.loadAsset("a");
  let done!: () => void;
  vi.mocked(f.queue.onSubmittedWorkDone).mockImplementation(
    () =>
      new Promise<undefined>((resolve) => {
        done = () => resolve(undefined);
      }),
  );
  const pending = f.app.unloadAsset("a");
  expect(f.app.world.count).toBe(2);
  expect(f.app.renderWorld.count).toBe(1);
  await expect(f.app.loadAsset("a")).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(done).toBeTypeOf("function"));
  done();
  await pending;
  vi.mocked(f.queue.onSubmittedWorkDone).mockResolvedValue(undefined);
  await f.app.dispose();
});
it("unloads a skinned asset after its entities were manually destroyed", async () => {
  const f = fixture();
  await f.app.loadAsset("a");
  for (let e = 2; e < f.app.world.nextEntity; e++) f.app.world.destroy(e);
  await f.app.unloadAsset("a");
  expect(f.app.skeletons.instances).toHaveLength(0);
  expect(f.app.skeletons.assets).toHaveLength(0);
  expect(f.app.animations.animators).toHaveLength(0);
  expect(f.app.animations.morphPool.count).toBe(0);
  await f.app.dispose();
});
