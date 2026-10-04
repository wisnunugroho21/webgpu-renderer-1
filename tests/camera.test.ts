import { expect, it } from "vitest";
import { Camera } from "../src/rendering/Camera";
import { FrameUniforms } from "../src/rendering/FrameUniforms";
import { ClusteredLighting } from "../src/rendering/lighting/ClusteredLighting";
import { World } from "../src/ecs/World";
import { CameraSystem } from "../src/ecs/systems/CameraSystem";
import { TransformSystem } from "../src/ecs/systems/TransformSystem";
import { cascadeSplit } from "../src/rendering/shadows/CascadeSplits";
/** Computes the (m[10]! * -z + m[14]!) / (m[11]! * -z + m[15]!) result. */
function depth(camera: Camera, z: number): number {
  const m = camera.projection;
  return (m[10]! * -z + m[14]!) / (m[11]! * -z + m[15]!);
}
it("preserves defaults, maps configurable clipping planes to standard Z, and caches unchanged matrices", () => {
  // Verifies preserves defaults, maps configurable clipping planes to standard Z, and caches unchanged matrices.

  const camera = new Camera();
  camera.update(2);
  expect(camera.projection[5]).toBeCloseTo(Math.sqrt(3));
  expect(camera.update(2)).toBe(false);
  camera.setPerspective({ fovY: Math.PI / 2, near: 2, far: 200 });
  camera.update(2);
  expect(depth(camera, 2)).toBeCloseTo(0);
  expect(depth(camera, 200)).toBeCloseTo(1);
  expect(camera.projection[0]).toBeCloseTo(0.5);
  camera.setPerspective({ aspect: 1 });
  camera.update(2);
  expect(camera.update(3)).toBe(false);
});
it("supports orthographic resize, zero near planes, and projection/cluster flags without changing ABI", () => {
  // Verifies supports orthographic resize, zero near planes, and projection/cluster flags without changing ABI.

  const camera = new Camera();
  camera.setOrthographic({ height: 8, near: 0, far: 40 });
  camera.update(2);
  expect(camera.projection[0]).toBe(0.125);
  expect(camera.projection[5]).toBe(0.25);
  expect(depth(camera, 0)).toBe(0);
  expect(depth(camera, 40)).toBeCloseTo(1);
  const uniforms = new FrameUniforms(),
    clusters = {
      tilesX: 1,
      tilesY: 1,
      tileSize: 64,
      slices: 24,
      maxLights: 64,
    } as ClusteredLighting;
  uniforms.update(camera, 1, clusters, true, 100, 100);
  expect(uniforms.data.length).toBe(48);
  expect(Array.from(uniforms.data.slice(40, 43))).toEqual([0, 40, 3]);
  expect(cascadeSplit(0, 40, 1, 4, 0)).toBe(10);
});
it("follows parented camera poses, applies component projection changes, switches cameras, and detaches removed cameras", () => {
  // Verifies follows parented camera poses, applies component projection changes, switches cameras, and detaches removed cameras.

  const world = new World(3),
    parent = world.create(),
    first = world.create(),
    second = world.create();
  for (const e of [parent, first, second]) world.transforms.add(e);
  world.transforms.setPosition(parent, 4, 0, 0);
  world.transforms.setPosition(first, 0, 2, 5);
  world.transforms.setParent(first, parent);
  world.cameras.setPerspective(first, { near: 1, far: 80 });
  world.cameras.setOrthographic(second, { height: 12 });
  new TransformSystem(3).update(world.transforms);
  const system = new CameraSystem(),
    camera = new Camera();
  system.select(first, world);
  system.update(world, camera);
  expect(Array.from(camera.position)).toEqual([4, 2, 5]);
  expect(Array.from(camera.target)).toEqual([4, 2, 4]);
  expect(camera.near).toBe(1);
  world.cameras.far[first] = 90;
  system.update(world, camera);
  expect(camera.far).toBe(90);
  system.select(second, world);
  system.update(world, camera);
  expect(camera.projectionType).toBe("orthographic");
  world.destroy(second);
  system.update(world, camera);
  expect(system.activeEntity).toBeNull();
});
it("rejects malformed projection values before changing the active configuration", () => {
  // Verifies rejects malformed projection values before changing the active configuration.

  const camera = new Camera();
  expect(() =>
    /** Delegates this operation to camera.setPerspective. */ camera.setPerspective(
      { far: Infinity },
    ),
  ).toThrow();
  expect(() =>
    /** Delegates this operation to camera.setPerspective. */ camera.setPerspective(
      { near: 0 },
    ),
  ).toThrow();
  expect(() =>
    /** Delegates this operation to camera.setOrthographic. */ camera.setOrthographic(
      { height: -1 },
    ),
  ).toThrow();
  expect(() =>
    /** Delegates this operation to camera.setUp. */ camera.setUp(0, 0, 0),
  ).toThrow();
  expect(() =>
    /** Delegates this operation to camera.setPosition. */ camera.setPosition(
      NaN,
      0,
      0,
    ),
  ).toThrow();
  expect(camera.projectionType).toBe("perspective");
});
import { RuntimeAsset } from "../src/assets/gltf/RuntimeAsset";
import { instantiate } from "../src/assets/gltf/instantiate";
import { MeshManager } from "../src/rendering/MeshManager";
import { MaterialManager } from "../src/rendering/materials/MaterialManager";
import { Mat4 } from "../src/math/Mat4";
it("instantiates authored glTF camera components and selects their projection and orientation", () => {
  // Verifies instantiates authored glTF camera components and selects their projection and orientation.

  const asset: RuntimeAsset = {
    meshes: [],
    materials: [],
    textures: [],
    skins: [],
    animations: [],
    scenes: [new Uint32Array([0, 1])],
    defaultScene: 0,
    cameras: [
      {
        type: "perspective",
        near: 0.5,
        far: 80,
        fovY: 1,
        aspect: 1.5,
        xMag: 0,
        yMag: 0,
      },
      {
        type: "orthographic",
        near: 0,
        far: 50,
        fovY: 0,
        aspect: null,
        xMag: 8,
        yMag: 4,
      },
    ],
    nodes: Array.from(
      { length: 2 },
      (
        _,
        i,
      ) => /** Builds a record containing name, children, mesh, skin, camera, position. */ ({
        name: "camera",
        children: new Uint32Array(),
        mesh: -1,
        skin: -1,
        camera: i,
        position: new Float32Array([3, 2, 5]),
        rotation: new Float32Array([0, Math.SQRT1_2, 0, Math.SQRT1_2]),
        scale: new Float32Array([1, 1, 1]),
        matrix: Mat4.create(),
        weights: new Float32Array(),
      }),
    ),
  };
  const world = new World(2),
    materials = new MaterialManager();
  materials.create();
  const nodes = instantiate(
    asset,
    world,
    {} as MeshManager,
    materials,
    0,
    undefined,
    undefined,
    { materialIds: [], defaultMaterial: 0, meshIds: [] },
  );
  new TransformSystem(2).update(world.transforms);
  const perspective = Array.from(nodes).find(
      (e) =>
        /** Evaluates the world.cameras.type[e] === 0 condition. */ world
          .cameras.type[e] === 0,
    )!,
    orthographic = Array.from(nodes).find(
      (e) =>
        /** Evaluates the world.cameras.type[e] === 1 condition. */ world
          .cameras.type[e] === 1,
    )!;
  const system = new CameraSystem(),
    camera = new Camera();
  system.select(perspective, world);
  system.update(world, camera);
  camera.update(2);
  expect(camera.near).toBe(0.5);
  expect(camera.target[0]).toBeCloseTo(2);
  expect(camera.target[2]).toBeCloseTo(5);
  system.select(orthographic, world);
  system.update(world, camera);
  camera.update(2);
  expect(camera.orthographicHeight).toBe(8);
  expect(camera.projection[0]).toBe(0.125);
  expect(camera.near).toBe(0);
});
