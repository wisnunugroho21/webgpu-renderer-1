import { SkeletonRegistry } from "../../animation/skinning/SkeletonRegistry";
import { AnimationSystem } from "../../ecs/systems/AnimationSystem";
import { RuntimeAsset } from "./RuntimeAsset";
import { World } from "../../ecs/World";
import { MeshManager } from "../../rendering/MeshManager";
import { MaterialManager } from "../../rendering/materials/MaterialManager";
export interface UploadedAsset {
  materialIds: number[];
  defaultMaterial: number;
  meshIds: number[][];
  /** Original preparation array carries the shared texture ownership lease. */
  textureGroups?: GPUBindGroup[];
}
/** Instantiate selected scene hierarchy into ECS; GPU assets are uploaded once per primitive. */
export function instantiate(
  asset: RuntimeAsset,
  world: World,
  meshes: MeshManager,
  materials: MaterialManager,
  scene = asset.defaultScene,
  animations?: AnimationSystem,
  skeletons?: SkeletonRegistry,
  uploaded?: UploadedAsset,
): Uint32Array {
  const roots = asset.scenes[scene];
  if (!roots) throw new Error("Unknown glTF scene");
  const entities = new Int32Array(asset.nodes.length).fill(-1),
    parents = new Int32Array(asset.nodes.length).fill(-1),
    active: number[] = [],
    pending = Array.from(roots);
  while (pending.length) {
    const node = pending.pop()!;
    if (entities[node] !== -1)
      throw new Error("glTF hierarchy cycle or repeated node");
    const data = asset.nodes[node];
    if (!data) throw new Error("Unknown glTF node");
    entities[node] = 0;
    active.push(node);
    for (const child of data.children) {
      parents[child] = node;
      pending.push(child);
    }
  }
  const primitiveCount = active.reduce(
    (sum, node) =>
      sum + (asset.meshes[asset.nodes[node]!.mesh]?.primitives.length ?? 0),
    0,
  );
  if (world.nextEntity + active.length + primitiveCount > world.capacity)
    throw new Error("World capacity exceeded by asset");
  if (!uploaded && materials.available < asset.materials.length + 1)
    throw new Error("Material capacity exceeded by asset");
  const materialIds =
      uploaded?.materialIds ??
      asset.materials.map((material) => materials.create(material)),
    defaultMaterial =
      uploaded?.defaultMaterial ??
      materials.create({ metallic: 1, roughness: 1 }),
    meshIds =
      uploaded?.meshIds ??
      asset.meshes.map((mesh) =>
        mesh.primitives.map((primitive) => meshes.upload(primitive)),
      );
  for (const node of active) {
    const entity = world.create(),
      data = asset.nodes[node]!;
    entities[node] = entity;
    world.transforms.add(entity);
    world.transforms.setPosition(
      entity,
      data.position[0]!,
      data.position[1]!,
      data.position[2]!,
    );
    world.transforms.setRotation(
      entity,
      data.rotation[0]!,
      data.rotation[1]!,
      data.rotation[2]!,
      data.rotation[3]!,
    );
    world.transforms.setScale(
      entity,
      data.scale[0]!,
      data.scale[1]!,
      data.scale[2]!,
    );
  }
  for (const node of active) {
    const camera = asset.cameras[asset.nodes[node]!.camera];
    if (!camera) continue;
    if (camera.type === "perspective")
      world.cameras.setPerspective(entities[node]!, {
        fovY: camera.fovY,
        near: camera.near,
        far: camera.far,
        aspect: camera.aspect ?? undefined,
      });
    else
      world.cameras.setOrthographic(entities[node]!, {
        height: camera.yMag * 2,
        near: camera.near,
        far: camera.far,
        aspect: camera.xMag / camera.yMag,
      });
  }
  for (const node of active) {
    const parent = parents[node]!;
    if (parent !== -1)
      world.transforms.setParent(entities[node]!, entities[parent]!);
    const data = asset.nodes[node]!,
      mesh = asset.meshes[data.mesh];
    if (!mesh) continue;
    mesh.primitives.forEach((primitive, index) => {
      const entity = world.create();
      world.transforms.add(entity);
      world.transforms.setParent(entity, entities[node]!);
      world.meshes.set(
        entity,
        meshIds[data.mesh]![index]!,
        primitive.material < 0
          ? defaultMaterial
          : materialIds[primitive.material]!,
      );
      const bounds = meshes.get(meshIds[data.mesh]![index]!).bounds!;
      world.bounds.setAABB(entity, bounds.min, bounds.max);
    });
  }
  skeletons?.attach(asset, entities, world, meshes);
  animations?.attach(asset, entities, world);
  return new Uint32Array(active.map((node) => entities[node]!));
}
