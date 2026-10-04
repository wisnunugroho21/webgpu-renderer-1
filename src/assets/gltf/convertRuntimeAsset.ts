import { Accessor, Document, Texture, TextureInfo } from "@gltf-transform/core";
import { RuntimeAsset, RuntimeTextureSlot } from "./RuntimeAsset";
/** Copy accessor values after library normalization; decoded arrays never alias parser storage. */
function readAccessor(accessor: Accessor | null): Float32Array {
  if (!accessor) return new Float32Array(0);
  const size = accessor.getElementSize(),
    out = new Float32Array(accessor.getCount() * size),
    element: number[] = [];
  for (let i = 0; i < accessor.getCount(); i++) {
    accessor.getElement(i, element);
    for (let j = 0; j < size; j++) out[i * size + j] = element[j]!;
  }
  return out;
}

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
      ) => /** Returns the ordered values needed by this operation. */ [
        node,
        index,
      ],
    ),
  );
  /** Selects the result according to texture && info. */
  const slot = (
    texture: Texture | null,
    info: TextureInfo | null,
  ): RuntimeTextureSlot | null =>
    texture && info
      ? {
          texture: textures.indexOf(texture),
          texCoord: info.getTexCoord(),
          magFilter: info.getMagFilter(),
          minFilter: info.getMinFilter(),
          wrapS: info.getWrapS(),
          wrapT: info.getWrapT(),
        }
      : null;
  return {
    meshes: meshes.map(
      (mesh) => /** Builds a record containing name, weights, primitives. */ ({
        name: mesh.getName(),
        weights: new Float32Array(mesh.getWeights()),
        primitives: mesh.listPrimitives().map((primitive) => {
          // Builds a record containing attributes, indices, mode, material, targets.

          const attributes: Record<string, Float32Array> = {};
          for (const semantic of primitive.listSemantics())
            attributes[semantic] = readAccessor(
              primitive.getAttribute(semantic),
            );
          const position = primitive.getAttribute("POSITION");
          if (!position) throw new Error("Primitive has no POSITION accessor");
          const indexAccessor = primitive.getIndices(),
            indices = new Uint32Array(
              indexAccessor ? indexAccessor.getCount() : position.getCount(),
            );
          for (let i = 0; i < indices.length; i++)
            indices[i] = indexAccessor ? indexAccessor.getScalar(i) : i;
          for (const index of indices)
            if (index >= position.getCount())
              throw new Error("Primitive index out of range");
          return {
            attributes,
            indices,
            mode: primitive.getMode(),
            material: materials.indexOf(primitive.getMaterial()!),
            targets: primitive.listTargets().map((target) => {
              // Returns deltas.

              const deltas: Record<string, Float32Array> = {};
              for (const semantic of target.listSemantics())
                deltas[semantic] = readAccessor(target.getAttribute(semantic));
              return deltas;
            }),
          };
        }),
      }),
    ),
    nodes: nodes.map(
      (
        node,
      ) => /** Builds a record containing name, children, mesh, skin, camera, position. */ ({
        name: node.getName(),
        children: new Uint32Array(
          node
            .listChildren()
            .map((child) =>
              /** Returns nodeIndex.get(child)!. */ nodeIndex.get(child)!,
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
    ),
    materials: materials.map((material) => {
      // Builds a record containing base color, metallic, roughness, alpha mode, alpha cutoff, double sided.

      const bindings: Record<string, RuntimeTextureSlot> = {};
      for (const [name, texture, info] of [
        [
          "baseColor",
          material.getBaseColorTexture(),
          material.getBaseColorTextureInfo(),
        ],
        [
          "normal",
          material.getNormalTexture(),
          material.getNormalTextureInfo(),
        ],
        [
          "metallicRoughness",
          material.getMetallicRoughnessTexture(),
          material.getMetallicRoughnessTextureInfo(),
        ],
        [
          "occlusion",
          material.getOcclusionTexture(),
          material.getOcclusionTextureInfo(),
        ],
        [
          "emissive",
          material.getEmissiveTexture(),
          material.getEmissiveTextureInfo(),
        ],
      ] as const) {
        const binding = slot(texture, info);
        if (binding) bindings[name] = binding;
      }
      return {
        baseColor: material.getBaseColorFactor(),
        metallic: material.getMetallicFactor(),
        roughness: material.getRoughnessFactor(),
        alphaMode: material.getAlphaMode(),
        alphaCutoff: material.getAlphaCutoff(),
        doubleSided: material.getDoubleSided(),
        textures: bindings,
        emissive: new Float32Array(material.getEmissiveFactor()),
        normalScale: material.getNormalScale(),
        occlusionStrength: material.getOcclusionStrength(),
      };
    }),
    textures: textures.map(
      (texture) => /** Builds a record containing name, mime type, image. */ ({
        name: texture.getName(),
        mimeType: texture.getMimeType(),
        image: (texture.getImage() ?? new Uint8Array(0)).slice(),
      }),
    ),
    skins: skins.map((skin) => {
      // Builds a record containing joints, inverse bind matrices, skeleton.

      const joints = new Uint32Array(
        skin
          .listJoints()
          .map((joint) =>
            /** Returns nodeIndex.get(joint)!. */ nodeIndex.get(joint)!,
          ),
      );
      let inverseBindMatrices = readAccessor(skin.getInverseBindMatrices());
      if (!inverseBindMatrices.length) {
        inverseBindMatrices = new Float32Array(joints.length * 16);
        for (let i = 0; i < joints.length; i++)
          for (let j = 0; j < 4; j++) inverseBindMatrices[i * 16 + j * 5] = 1;
      }
      if (inverseBindMatrices.length !== joints.length * 16)
        throw new Error("Inverse-bind matrix count does not match joints");
      return {
        joints,
        inverseBindMatrices,
        skeleton: skin.getSkeleton() ? nodeIndex.get(skin.getSkeleton()!)! : -1,
      };
    }),
    animations: root
      .listAnimations()
      .map((animation) => /** Builds a record containing name, channels. */ ({
        name: animation.getName(),
        channels: animation.listChannels().map((channel) => {
          // Builds a record containing node, path, interpolation, input, output, element size.

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
      })),
    cameras: cameras.map(
      (
        camera,
      ) => /** Builds a record containing type, near, far, aspect, fov y, x mag. */ ({
        type: camera.getType(),
        near: camera.getZNear(),
        far: camera.getZFar(),
        aspect: camera.getAspectRatio(),
        fovY: camera.getYFov(),
        xMag: camera.getXMag(),
        yMag: camera.getYMag(),
      }),
    ),
    scenes: scenes.map(
      (scene) =>
        /** Creates Uint32Array storage for this operation. */ new Uint32Array(
          scene
            .listChildren()
            .map((node) =>
              /** Returns nodeIndex.get(node)!. */ nodeIndex.get(node)!,
            ),
        ),
    ),
    defaultScene: Math.max(0, scenes.indexOf(root.getDefaultScene()!)),
  };
}
