import type {
  Node,
  Mesh,
  Skin,
  Camera,
  Animation,
  Scene,
} from "@gltf-transform/core";
import type { RuntimeAsset } from "./RuntimeAsset";
import { readAccessor } from "./readAccessor";

/** Copy scene references, transforms and inherited mesh morph weights. */
export function convertNodes(
  nodes: Node[],
  meshes: Mesh[],
  skins: Skin[],
  cameras: Camera[],
  nodeIndex: Map<Node, number>,
): RuntimeAsset["nodes"] {
  return nodes.map(
    (
      node,
    ) => /** Use table indices for references so the result can cross a worker boundary. */ ({
      name: node.getName(),
      children: new Uint32Array(
        node
          .listChildren()
          .map((child) =>
            /** Resolve hierarchy links without retaining parser nodes. */ nodeIndex.get(
              child,
            )!,
          ),
      ),
      mesh: meshes.indexOf(node.getMesh()!),
      skin: skins.indexOf(node.getSkin()!),
      camera: cameras.indexOf(node.getCamera()!),
      position: new Float32Array(node.getTranslation()),
      rotation: new Float32Array(node.getRotation()),
      scale: new Float32Array(node.getScale()),
      matrix: new Float32Array(node.getMatrix()),
      weights: new Float32Array(
        node.getWeights().length
          ? node.getWeights()
          : (node.getMesh()?.getWeights() ?? []),
      ),
    }),
  );
}

/** Validate complete channels and copy normalized keyframes into engine storage. */
export function convertAnimations(
  animations: Animation[],
  nodeIndex: Map<Node, number>,
): RuntimeAsset["animations"] {
  return animations.map(
    (animation) => /** Preserve channel order within each named clip. */ ({
      name: animation.getName(),
      channels: animation.listChannels().map((channel) => {
        // Reject incomplete channels before copying keyframe arrays.

        const sampler = channel.getSampler(),
          node = channel.getTargetNode(),
          path = channel.getTargetPath();
        if (
          !sampler ||
          !node ||
          !path ||
          !sampler.getInput() ||
          !sampler.getOutput()
        )
          throw new Error("Incomplete animation channel");
        return {
          node: nodeIndex.get(node)!,
          path,
          interpolation: sampler.getInterpolation(),
          input: readAccessor(sampler.getInput()),
          output: readAccessor(sampler.getOutput()),
          elementSize: sampler.getOutput()!.getElementSize(),
        };
      }),
    }),
  );
}

/** Copy projection metadata without constructing runtime camera objects. */
export function convertCameras(cameras: Camera[]): RuntimeAsset["cameras"] {
  return cameras.map(
    (
      camera,
    ) => /** Retain both perspective and orthographic projection fields. */ ({
      type: camera.getType(),
      near: camera.getZNear(),
      far: camera.getZFar(),
      aspect: camera.getAspectRatio(),
      fovY: camera.getYFov(),
      xMag: camera.getXMag(),
      yMag: camera.getYMag(),
    }),
  );
}

/** Resolve scene roots to stable indices in the decoded node table. */
export function convertScenes(
  scenes: Scene[],
  nodeIndex: Map<Node, number>,
): RuntimeAsset["scenes"] {
  return scenes.map(
    (scene) =>
      /** Copy root indices into transferable scene storage. */ new Uint32Array(
        scene
          .listChildren()
          .map((node) =>
            /** Resolve scene roots against the same node table as hierarchy links. */ nodeIndex.get(
              node,
            )!,
          ),
      ),
  );
}
