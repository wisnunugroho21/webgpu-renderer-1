import type { Document } from "@gltf-transform/core";
import type { RuntimeAsset } from "./RuntimeAsset";
import { convertMeshes, convertSkins } from "./convertGeometry";
import { convertMaterials, convertTextures } from "./convertMaterials";
import {
  convertNodes,
  convertAnimations,
  convertCameras,
  convertScenes,
} from "./convertScene";
/** Pure document-to-engine conversion. No fetching, codec state or GPU ownership crosses this boundary. */
export function convertRuntimeAsset(document: Document): RuntimeAsset {
  const root = document.getRoot(),
    meshes = root.listMeshes(),
    nodes = root.listNodes(),
    materials = root.listMaterials(),
    textures = root.listTextures(),
    skins = root.listSkins(),
    cameras = root.listCameras(),
    scenes = root.listScenes();
  const nodeIndex = new Map(
    nodes.map(
      (
        node,
        index,
      ) => /** Use document order for all decoded node references. */ [
        node,
        index,
      ],
    ),
  );
  return {
    meshes: convertMeshes(meshes, materials),
    nodes: convertNodes(nodes, meshes, skins, cameras, nodeIndex),
    materials: convertMaterials(materials, textures),
    textures: convertTextures(textures),
    skins: convertSkins(skins, nodeIndex),
    animations: convertAnimations(root.listAnimations(), nodeIndex),
    cameras: convertCameras(cameras),
    scenes: convertScenes(scenes, nodeIndex),
    defaultScene: Math.max(0, scenes.indexOf(root.getDefaultScene()!)),
  };
}
