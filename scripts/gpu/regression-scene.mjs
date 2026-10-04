/** Runs inside Chrome via page.evaluate. Keep all helpers inside this callback:
 * Playwright serializes its source, so it cannot close over Node module imports.
 * The integrated scene deliberately retains asset/state transitions between checks. */
export const runRegressionScene = async () => {
  const app = window.rendererApp;
  app.stop();
  const gpu = app.gpu;
  gpu.device.pushErrorScope("validation");
  // Readback is confined to the regression harness, never the normal frame path.
  const texture = gpu.context.getCurrentTexture();
  const encoder = gpu.device.createCommandEncoder();
  app.renderer.encode(
    encoder,
    texture.createView({ format: gpu.renderFormat }),
  );
  const buffer = gpu.device.createBuffer({
    size: 512,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow: 256 },
    [1, 1],
  );
  encoder.copyTextureToBuffer(
    {
      texture,
      origin: [Math.floor(texture.width / 2), Math.floor(texture.height / 2)],
    },
    { buffer, offset: 256, bytesPerRow: 256 },
    [1, 1],
  );
  gpu.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const mappedBytes = new Uint8Array(buffer.getMappedRange());
  const pixel = Array.from(mappedBytes.slice(0, 4));
  const centerPixel = Array.from(mappedBytes.slice(256, 260));
  buffer.unmap();
  buffer.destroy();
  const materialChecks = {};
  for (const [name, material] of [
    ["tint", { baseColor: [1, 0, 1, 1] }],
    ["mask", { baseColor: [1, 1, 1, 0.1], alphaMode: "MASK" }],
    ["blend", { baseColor: [1, 1, 1, 0.5], alphaMode: "BLEND" }],
    ["offscreen", {}],
  ]) {
    app.materials.set(0, material);
    if (name === "offscreen") {
      app.world.transforms.setPosition(app.sceneEntity, 100, 0, 0);
      app.transformSystem.update(app.world.transforms);
      app.animatedBounds.update(
        app.world,
        app.renderer.meshes,
        app.skeletons,
        app.animations.morphPool,
      );
      app.extractor.extract(
        app.world,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
    }
    const target = gpu.context.getCurrentTexture(),
      commands = gpu.device.createCommandEncoder();
    app.renderer.encode(
      commands,
      target.createView({ format: gpu.renderFormat }),
    );
    const readback = gpu.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    commands.copyTextureToBuffer(
      {
        texture: target,
        origin: [Math.floor(target.width / 2), Math.floor(target.height / 2)],
      },
      { buffer: readback, bytesPerRow: 256 },
      [1, 1],
    );
    gpu.queue.submit([commands.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    materialChecks[name] = Array.from(
      new Uint8Array(readback.getMappedRange()).slice(0, 4),
    );
    readback.unmap();
    readback.destroy();
    if (name === "offscreen")
      materialChecks.offscreenStats = { ...app.renderer.stats };
  }
  app.world.transforms.setPosition(app.sceneEntity, 0, 0, 0);
  app.transformSystem.update(app.world.transforms);
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(
    app.world,
    app.renderWorld,
    app.skeletons,
    app.animations.morphPool,
  );
  app.materials.set(0, {});
  app.world.destroy(app.sceneEntity);
  await app.loadAsset(new URL("/regression/triangle.glb", location.href).href);
  app.transformSystem.update(app.world.transforms);
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(
    app.world,
    app.renderWorld,
    app.skeletons,
    app.animations.morphPool,
  );
  app.renderer.camera.setPosition(0, 0, 5);
  const assetTexture = gpu.context.getCurrentTexture(),
    assetCommands = gpu.device.createCommandEncoder();
  app.renderer.encode(
    assetCommands,
    assetTexture.createView({ format: gpu.renderFormat }),
  );
  const assetBuffer = gpu.device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  assetCommands.copyTextureToBuffer(
    {
      texture: assetTexture,
      origin: [
        Math.floor(assetTexture.width / 2),
        Math.floor(assetTexture.height / 2),
      ],
    },
    { buffer: assetBuffer, bytesPerRow: 256 },
    [1, 1],
  );
  gpu.queue.submit([assetCommands.finish()]);
  await assetBuffer.mapAsync(GPUMapMode.READ);
  const assetPixel = Array.from(
    new Uint8Array(assetBuffer.getMappedRange()).slice(0, 4),
  );
  assetBuffer.unmap();
  assetBuffer.destroy();

  // Load every texture role through the production glTF path.
  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== app.defaultLightEntity)
      app.world.destroy(e);
  const pbrId = app.materials.count;
  const roots = await app.loadAsset(
    new URL("/regression/pbr.glb", location.href).href,
  );
  app.transformSystem.update(app.world.transforms);
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(
    app.world,
    app.renderWorld,
    app.skeletons,
    app.animations.morphPool,
  );
  const pbrChecks = {};
  const tex = {
    baseColor: { texCoord: 0 },
    metallicRoughness: { texCoord: 0 },
    normal: { texCoord: 0 },
    occlusion: { texCoord: 0 },
    emissive: { texCoord: 0 },
  };
  const cases = [
    [
      "emissive",
      {
        baseColor: [0, 0, 0, 1],
        metallic: 1,
        emissive: [1, 1, 1],
        textures: tex,
      },
    ],
    [
      "uv1",
      {
        baseColor: [0, 0, 0, 1],
        metallic: 1,
        emissive: [1, 1, 1],
        textures: { ...tex, emissive: { texCoord: 1 } },
      },
    ],
    [
      "flat",
      {
        metallic: 0,
        roughness: 1,
        normalScale: 0,
        occlusionStrength: 0,
        textures: tex,
      },
    ],
    [
      "normal",
      { metallic: 0, roughness: 1, occlusionStrength: 0, textures: tex },
    ],
    [
      "metal",
      {
        metallic: 1,
        roughness: 1,
        normalScale: 0,
        occlusionStrength: 0,
        textures: tex,
      },
    ],
    [
      "smooth",
      {
        metallic: 0,
        roughness: 0.2,
        normalScale: 0,
        occlusionStrength: 0,
        textures: tex,
      },
    ],
    ["ao", { metallic: 0, roughness: 1, normalScale: 0, textures: tex }],
    [
      "culled",
      {
        baseColor: [0, 0, 0, 1],
        metallic: 1,
        emissive: [1, 1, 1],
        textures: tex,
      },
    ],
    [
      "doubleSided",
      {
        baseColor: [0, 0, 0, 1],
        metallic: 1,
        emissive: [1, 1, 1],
        textures: tex,
        doubleSided: true,
      },
    ],
  ];
  for (const [name, material] of cases) {
    app.materials.set(pbrId, material);
    if (name === "culled") {
      app.world.transforms.setScale(roots[0], -1, 1, 1);
      app.transformSystem.update(app.world.transforms);
      app.animatedBounds.update(
        app.world,
        app.renderer.meshes,
        app.skeletons,
        app.animations.morphPool,
      );
      app.extractor.extract(
        app.world,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
    }
    const target = gpu.context.getCurrentTexture(),
      enc = gpu.device.createCommandEncoder();
    app.renderer.encode(enc, target.createView({ format: gpu.renderFormat }));
    const rb = gpu.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    enc.copyTextureToBuffer(
      { texture: target, origin: [target.width >> 1, target.height >> 1] },
      { buffer: rb, bytesPerRow: 256 },
      [1, 1],
    );
    gpu.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    pbrChecks[name] = Array.from(
      new Uint8Array(rb.getMappedRange()).slice(0, 4),
    );
    rb.unmap();
    rb.destroy();
  }

  // Non-power-of-two image, reused across roles, assets and concurrent requests.
  const canvas = new OffscreenCanvas(3, 5),
    ctx = canvas.getContext("2d");
  const pixels = new Uint8ClampedArray(3 * 5 * 4);
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      const i = (y * 3 + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = x === 1 ? 255 : 0;
      pixels[i + 3] = 255;
    }
  ctx.putImageData(new ImageData(pixels, 3, 5), 0, 0);
  const bytes = new Uint8Array(
    await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
  );
  const slot = {
    texture: 0,
    texCoord: 0,
    wrapS: 10497,
    wrapT: 10497,
    minFilter: 9987,
    magFilter: 9729,
  };
  const testAsset = {
    textures: [{ name: "Odd dimensions", mimeType: "image/png", image: bytes }],
    materials: [
      {
        textures: {
          baseColor: slot,
          emissive: slot,
          metallicRoughness: slot,
        },
      },
    ],
  };
  const textures = app.renderer.textures,
    before = { ...textures.metrics },
    beforeResources = { ...app.renderer.resources.stats };
  const start = performance.now();
  await Promise.all([textures.prepare(testAsset), textures.prepare(testAsset)]);
  const coldMs = performance.now() - start,
    after = { ...textures.metrics };
  const warmStart = performance.now();
  await textures.prepare({
    ...testAsset,
    textures: [{ ...testAsset.textures[0], name: "Different asset name" }],
  });
  const warmMs = performance.now() - warmStart;
  const cachedSamples = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    await textures.prepare(testAsset);
    cachedSamples.push(performance.now() - t);
  }
  cachedSamples.sort((a, b) => a - b);
  const textureChecks = {
    coldMs,
    warmMs,
    cachedMedianMs: cachedSamples[15],
    cachedP95Ms: cachedSamples[28],
    samplerCreations:
      app.renderer.resources.stats.samplerCreations -
      beforeResources.samplerCreations,
    misses: after.misses - before.misses,
    decodes: after.decodes - before.decodes,
    hits: after.hits - before.hits,
    warmDecodes: textures.metrics.decodes - after.decodes,
    warmMisses: textures.metrics.misses - after.misses,
    creations:
      app.renderer.resources.stats.textureCreations -
      beforeResources.textureCreations,
    mips: {},
  };
  const failedBefore = textures.cache.size;
  const broken = {
    ...testAsset,
    textures: [
      {
        name: "Invalid image",
        mimeType: "image/png",
        image: new Uint8Array([1, 2, 3]),
      },
    ],
  };
  let failures = 0;
  for (let i = 0; i < 2; i++) {
    try {
      await textures.prepare(broken);
    } catch {
      failures++;
    }
  }
  textureChecks.decodeFailures = failures;
  textureChecks.failedCacheEntries = textures.cache.size - failedBefore;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  for (const format of ["rgba8unorm", "rgba8unorm-srgb"]) {
    const texture = await textures.cache.get(`${hash}:${format}`);
    const rb = gpu.device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      enc = gpu.device.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture, mipLevel: texture.mipLevelCount - 1 },
      { buffer: rb, bytesPerRow: 256 },
      [1, 1],
    );
    gpu.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    textureChecks.mips[format] = {
      levels: texture.mipLevelCount,
      pixel: Array.from(new Uint8Array(rb.getMappedRange()).slice(0, 4)),
    };
    rb.unmap();
    rb.destroy();
  }

  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== app.defaultLightEntity)
      app.world.destroy(e);
  const animatedRoots = await app.loadAsset(
      new URL("/regression/animated.glb", location.href).href,
    ),
    entity = animatedRoots[0];
  const animator = app.animations.animators.at(-1);
  animator.loop = false;
  animator.play();
  animator.update(0.5);
  app.transformSystem.update(app.world.transforms);
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(
    app.world,
    app.renderWorld,
    app.skeletons,
    app.animations.morphPool,
  );
  const morphId = app.world.morphs.stateId[entity];
  const animationChecks = {
    time: animator.currentTime,
    position: app.world.transforms.positionX[entity],
    scale: app.world.transforms.scaleX[entity],
    rotation: Array.from([
      app.world.transforms.rotationZ[entity],
      app.world.transforms.rotationW[entity],
    ]),
    weights: Array.from(app.animations.morphStates[morphId].weights),
    renderMorphId: app.renderWorld.morphStateId[0],
    morphId,
  };
  animator.update(0.5);
  app.transformSystem.update(app.world.transforms);
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(
    app.world,
    app.renderWorld,
    app.skeletons,
    app.animations.morphPool,
  );
  const animatedTexture = gpu.context.getCurrentTexture(),
    animatedEncoder = gpu.device.createCommandEncoder();
  app.renderer.encode(
    animatedEncoder,
    animatedTexture.createView({ format: gpu.renderFormat }),
  );
  gpu.queue.submit([animatedEncoder.finish()]);
  animationChecks.endTime = animator.currentTime;
  animationChecks.playing = animator.playing;
  animationChecks.drawCalls = app.renderer.stats.drawCalls;

  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== app.defaultLightEntity)
      app.world.destroy(e);
  const beforeSkins = app.skeletons.instances.length;
  await app.loadAsset(new URL("/regression/skinned.glb", location.href).href);
  app.transformSystem.update(app.world.transforms);
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(
    app.world,
    app.renderWorld,
    app.skeletons,
    app.animations.morphPool,
  );
  const instances = app.skeletons.instances.slice(beforeSkins);
  const morphChecks = { states: [], targets: [] };
  for (const entity of app.renderWorld.entityId.slice(
    0,
    app.renderWorld.count,
  )) {
    const id = app.world.morphs.stateId[entity],
      state = app.animations.morphStates[id];
    morphChecks.states.push({
      offset: state.weightOffset,
      count: state.targetCount,
      weights: Array.from(state.weights),
      shared: state.weights.buffer === app.animations.morphPool.data.buffer,
    });
    const morph = app.renderer.meshes.get(
      app.world.meshes.meshId[entity],
    ).morph;
    morphChecks.targets.push({
      count: morph.targetCount,
      vertices: morph.vertexCount,
      position: Array.from(morph.targets[0].POSITION.slice(0, 3)),
    });
  }

  app.skeletonSystem.update(app.world, app.skeletons);
  const initialMatrices = instances.map((i) => Array.from(i.matrices));
  const changed = app.skeletonSystem.updatedJoints;
  app.skeletonSystem.update(app.world, app.skeletons);
  const unchanged = app.skeletonSystem.updatedJoints;
  const skinChecks = {
    instances: instances.length,
    initialMatrices,
    changed,
    unchanged,
    sharedAsset: instances[0].asset === instances[1].asset,
    independentMatrices: instances[0].matrices !== instances[1].matrices,
    jointCount: instances[0].jointCount,
    parents: Array.from(instances[0].asset.parents),
    renderIds: Array.from(
      app.renderWorld.skinInstanceId.slice(0, app.renderWorld.count),
    ),
    weights: Array.from(
      app.renderer.meshes
        .get(app.renderWorld.meshId[0])
        .skin.primary.weights.slice(0, 4),
    ),
  };

  const renderJoints = () => {
    app.animatedBounds.update(
      app.world,
      app.renderer.meshes,
      app.skeletons,
      app.animations.morphPool,
    );
    app.extractor.extract(
      app.world,
      app.renderWorld,
      app.skeletons,
      app.animations.morphPool,
    );
    const enc = gpu.device.createCommandEncoder();
    app.renderer.encode(
      enc,
      gpu.context.getCurrentTexture().createView({ format: gpu.renderFormat }),
    );
    gpu.queue.submit([enc.finish()]);
    return { ...app.renderer.stats };
  };
  const fullJointStats = renderJoints();
  const readJoint = gpu.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
    copyJoint = gpu.device.createCommandEncoder();
  copyJoint.copyBufferToBuffer(
    app.renderer.joints.buffer,
    0,
    readJoint,
    0,
    256,
  );
  gpu.queue.submit([copyJoint.finish()]);
  await readJoint.mapAsync(GPUMapMode.READ);
  const gpuJointX = [...new Float32Array(readJoint.getMappedRange())].filter(
    (_, i) => i === 12 || i === 44,
  );
  readJoint.unmap();
  readJoint.destroy();
  const unchangedJointStats = renderJoints();
  const jointResources = { ...app.renderer.resources.stats };
  app.world.transforms.setPosition(instances[0].jointEntities[1], 0, 2, 0);
  app.transformSystem.update(app.world.transforms);
  app.skeletonSystem.update(app.world, app.skeletons);
  const partialJointStats = renderJoints();
  const jointChecks = {
    full: fullJointStats,
    unchanged: unchangedJointStats,
    partial: partialJointStats,
    gpuJointX,
    offsets: instances.map((i) => i.jointOffset),
    writes: app.renderer.joints.writes,
    resourcesBefore: jointResources,
    resourcesAfter: { ...app.renderer.resources.stats },
  };

  // CPU deformation is used only to construct this regression reference once.
  const angle = 0.35,
    s = Math.sin(angle),
    c = Math.cos(angle),
    rootJoint = instances[0].jointEntities[0],
    tipJoint = instances[0].jointEntities[1];
  app.world.transforms.setPosition(tipJoint, 0, 1, 0);
  app.world.transforms.setRotation(
    rootJoint,
    0,
    Math.sin(angle / 2),
    0,
    Math.cos(angle / 2),
  );
  app.transformSystem.update(app.world.transforms);
  app.skeletonSystem.update(app.world, app.skeletons);
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(
    app.world,
    app.renderWorld,
    app.skeletons,
    app.animations.morphPool,
  );
  const rw = app.renderWorld,
    renderer = app.renderer,
    skinnedMesh = rw.meshId[0],
    skinOffset = rw.jointOffset[0],
    materialId = rw.materialId[0];
  app.materials.set(materialId, { metallic: 0, roughness: 1, textures: tex });
  renderer.cullingEnabled = false;
  rw.count = 1;
  const sampleSkin = async () => {
    const texture = gpu.context.getCurrentTexture(),
      enc = gpu.device.createCommandEncoder(),
      rb = gpu.device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
    enc.copyTextureToBuffer(
      { texture, origin: [texture.width >> 1, texture.height >> 1] },
      { buffer: rb, bytesPerRow: 256 },
      [1, 1],
    );
    gpu.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const pixel = Array.from(new Uint8Array(rb.getMappedRange()).slice(0, 4));
    rb.unmap();
    rb.destroy();
    return pixel;
  };
  rw.morphCounts[0] = 0;
  const skinPixel = await sampleSkin();
  const positions = new Float32Array([-c, -1, s, c, -1, -s, 0, 1, 0]);
  const referenceMesh = renderer.meshes.upload({
    mode: 4,
    material: materialId,
    indices: new Uint32Array([0, 1, 2]),
    targets: [],
    attributes: {
      POSITION: positions,
      NORMAL: new Float32Array([s, 0, c, s, 0, c, s, 0, c]),
      TANGENT: new Float32Array([c, 0, -s, 1, c, 0, -s, 1, c, 0, -s, 1]),
      TEXCOORD_0: new Float32Array([0.25, 0.5, 0.25, 0.5, 0.25, 0.5]),
      TEXCOORD_1: new Float32Array([0.75, 0.5, 0.75, 0.5, 0.75, 0.5]),
    },
  });
  rw.meshId[0] = referenceMesh;
  rw.jointCounts[0] = 0;
  rw.morphCounts[0] = 0;
  rw.matrices.fill(0, 0, 16);
  rw.matrices[0] = rw.matrices[5] = rw.matrices[10] = rw.matrices[15] = 1;
  const referencePixel = await sampleSkin();
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  rw.count = 1;
  const originalWrite = gpu.queue.writeBuffer.bind(gpu.queue);
  let vertexWrites = 0;
  gpu.queue.writeBuffer = (...args) => {
    if (args[0] === renderer.meshes.get(skinnedMesh).vertex) vertexWrites++;
    return originalWrite(...args);
  };
  app.world.transforms.setPosition(rootJoint, 10, 0, 0);
  app.transformSystem.update(app.world.transforms);
  app.skeletonSystem.update(app.world, app.skeletons);
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  rw.count = 1;
  rw.morphCounts[0] = 0;
  const movedPixel = await sampleSkin();
  gpu.queue.writeBuffer = originalWrite;
  app.world.transforms.setPosition(rootJoint, 0, 0, 0);
  app.transformSystem.update(app.world.transforms);
  app.skeletonSystem.update(app.world, app.skeletons);
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  rw.count = 1000;
  for (let i = 0; i < 1000; i++) {
    rw.meshId[i] = skinnedMesh;
    rw.materialId[i] = materialId;
    rw.transformIndex[i] = i;
    rw.jointOffset[i] = 0;
    rw.jointCounts[i] = 2;
    rw.morphCounts[i] = 0;
    const o = i * 16;
    rw.matrices.fill(0, o, o + 16);
    rw.matrices[o] = rw.matrices[o + 5] = rw.matrices[o + 10] = 0.03;
    rw.matrices[o + 15] = 1;
    rw.matrices[o + 12] = ((i % 40) - 20) * 0.12;
    rw.matrices[o + 13] = (Math.floor(i / 40) - 12) * 0.12;
  }
  const skinSamples = [],
    skinResources = { ...renderer.resources.stats };
  for (let frame = 0; frame < 12; frame++) {
    const enc = gpu.device.createCommandEncoder(),
      texture = gpu.context.getCurrentTexture(),
      t = performance.now();
    renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
    if (frame >= 2) skinSamples.push(performance.now() - t);
    gpu.queue.submit([enc.finish()]);
    await gpu.queue.onSubmittedWorkDone();
  }
  skinSamples.sort((a, b) => a - b);
  const gpuSkinChecks = {
    skinPixel,
    referencePixel,
    movedPixel,
    vertexWrites,
    medianCpuMs: skinSamples[5],
    p95CpuMs: skinSamples[9],
    stats: { ...renderer.stats },
    resourcesBefore: skinResources,
    resourcesAfter: { ...renderer.resources.stats },
  };

  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  const meshMorph = renderer.meshes.get(skinnedMesh),
    state = app.animations.morphStates[rw.morphStateId[0]],
    rb = gpu.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
    enc = gpu.device.createCommandEncoder();
  for (const [i, buffer] of [
    renderer.morphDeltas.position,
    renderer.morphDeltas.normal,
    renderer.morphDeltas.tangent,
  ].entries())
    enc.copyBufferToBuffer(buffer, meshMorph.morphOffset * 16, rb, i * 64, 16);
  enc.copyBufferToBuffer(
    renderer.morphWeights.buffer,
    state.weightOffset * 4,
    rb,
    192,
    4,
  );
  gpu.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const data = new Float32Array(rb.getMappedRange()),
    morphBufferChecks = {
      position: Array.from(data.slice(0, 4)),
      normal: Array.from(data.slice(16, 20)),
      tangent: Array.from(data.slice(32, 36)),
      weight: data[48],
      expectedWeight: state.weights[0],
      deltaRecords: renderer.morphDeltas.count,
    };
  rb.unmap();
  rb.destroy();
  state.weights[0] += 0.25;
  state.dirty = true;
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  const morphEncode = gpu.device.createCommandEncoder();
  renderer.encode(
    morphEncode,
    gpu.context.getCurrentTexture().createView({ format: gpu.renderFormat }),
  );
  gpu.queue.submit([morphEncode.finish()]);
  morphBufferChecks.changedBytes = renderer.stats.morphUploadBytes;
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  const unchangedMorph = gpu.device.createCommandEncoder();
  renderer.encode(
    unchangedMorph,
    gpu.context.getCurrentTexture().createView({ format: gpu.renderFormat }),
  );
  gpu.queue.submit([unchangedMorph.finish()]);
  morphBufferChecks.unchangedBytes = renderer.stats.morphUploadBytes;

  const repeat = (v) => new Float32Array([...v, ...v, ...v]);
  const morphMesh = renderer.meshes.upload({
    mode: 4,
    material: materialId,
    indices: new Uint32Array([0, 1, 2]),
    targets: [
      {
        POSITION: repeat([0, 0, 1]),
        NORMAL: repeat([0.25, 0, -0.1]),
        TANGENT: repeat([0, 0.1, 0]),
      },
      {
        POSITION: repeat([1, 0, 0]),
        NORMAL: repeat([0, 0.2, 0]),
        TANGENT: repeat([0, 0, 0.2]),
      },
    ],
    attributes: {
      POSITION: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      NORMAL: repeat([0, 0, 1]),
      JOINTS_0: repeat([0, 0, 0, 0]),
      WEIGHTS_0: repeat([1, 0, 0, 0]),
      TANGENT: repeat([1, 0, 0, 1]),
      TEXCOORD_0: new Float32Array([0.25, 0.5, 0.25, 0.5, 0.25, 0.5]),
      TEXCOORD_1: new Float32Array([0.75, 0.5, 0.75, 0.5, 0.75, 0.5]),
    },
  });
  const newStateId = app.animations.morphPool.create(2, [0.5, -0.25]),
    morphState = app.animations.morphStates[newStateId];
  const morphEntity = rw.entityId[0];
  app.world.meshes.meshId[morphEntity] = morphMesh;
  app.world.morphs.stateId[morphEntity] = newStateId;
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  rw.count = 1;
  rw.jointCounts[0] = 0;
  rw.matrices.fill(0, 0, 16);
  rw.matrices[0] = rw.matrices[5] = rw.matrices[10] = rw.matrices[15] = 1;
  const morphedPixel = await sampleSkin();
  const morphReference = renderer.meshes.upload({
    mode: 4,
    material: materialId,
    indices: new Uint32Array([0, 1, 2]),
    targets: [],
    attributes: {
      POSITION: new Float32Array([
        -1.25, -1, 0.5, 0.75, -1, 0.5, -0.25, 1, 0.5,
      ]),
      NORMAL: repeat([0.125, -0.05, 0.95]),
      TANGENT: repeat([1, 0.05, -0.05, 1]),
      TEXCOORD_0: new Float32Array([0.25, 0.5, 0.25, 0.5, 0.25, 0.5]),
      TEXCOORD_1: new Float32Array([0.75, 0.5, 0.75, 0.5, 0.75, 0.5]),
    },
  });
  rw.meshId[0] = morphReference;
  rw.morphCounts[0] = 0;
  const morphReferencePixel = await sampleSkin();
  rw.meshId[0] = morphMesh;
  rw.morphCounts[0] = 2;
  const baseVertex = renderer.meshes.get(morphMesh).vertex,
    write = gpu.queue.writeBuffer.bind(gpu.queue);
  let morphVertexWrites = 0;
  gpu.queue.writeBuffer = (...args) => {
    if (args[0] === baseVertex) morphVertexWrites++;
    return write(...args);
  };
  morphState.weights[1] = 10;
  morphState.dirty = true;
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  rw.count = 1;
  rw.jointCounts[0] = 0;
  rw.matrices.fill(0, 0, 16);
  rw.matrices[0] = rw.matrices[5] = rw.matrices[10] = rw.matrices[15] = 1;
  const morphedMovedPixel = await sampleSkin();
  gpu.queue.writeBuffer = write;
  morphState.weights[1] = -0.25;
  morphState.dirty = true;
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  rw.count = 1000;
  const morphResources = { ...renderer.resources.stats },
    morphSamples = [];
  for (let i = 0; i < 1000; i++) {
    rw.meshId[i] = morphMesh;
    rw.materialId[i] = materialId;
    rw.transformIndex[i] = i;
    rw.jointCounts[i] = 0;
    rw.morphOffset[i] = morphState.weightOffset;
    rw.morphCounts[i] = 2;
    const o = i * 16;
    rw.matrices.fill(0, o, o + 16);
    rw.matrices[o] = rw.matrices[o + 5] = rw.matrices[o + 10] = 0.03;
    rw.matrices[o + 15] = 1;
    rw.matrices[o + 12] = ((i % 40) - 20) * 0.12;
    rw.matrices[o + 13] = (Math.floor(i / 40) - 12) * 0.12;
  }
  for (let frame = 0; frame < 12; frame++) {
    const enc = gpu.device.createCommandEncoder(),
      target = gpu.context.getCurrentTexture(),
      t = performance.now();
    renderer.encode(enc, target.createView({ format: gpu.renderFormat }));
    if (frame >= 2) morphSamples.push(performance.now() - t);
    gpu.queue.submit([enc.finish()]);
    await gpu.queue.onSubmittedWorkDone();
  }
  morphSamples.sort((a, b) => a - b);
  const gpuMorphChecks = {
    morphedPixel,
    referencePixel: morphReferencePixel,
    movedPixel: morphedMovedPixel,
    vertexWrites: morphVertexWrites,
    medianCpuMs: morphSamples[5],
    p95CpuMs: morphSamples[9],
    stats: { ...renderer.stats },
    resourcesBefore: morphResources,
    resourcesAfter: { ...renderer.resources.stats },
  };

  rw.count = 1;
  rw.meshId[0] = morphMesh;
  rw.morphOffset[0] = morphState.weightOffset;
  rw.morphCounts[0] = 2;
  rw.jointOffset[0] = 0;
  rw.jointCounts[0] = 2;
  rw.matrices.fill(0, 0, 16);
  rw.matrices[0] = rw.matrices[5] = rw.matrices[10] = rw.matrices[15] = 1;
  const combinedPixel = await sampleSkin();
  let combinedIndirectPixel = null;
  if (renderer.gpuDraws.supported) {
    rw.sphere.set([0, 0, 0, 10], 0);
    renderer.submissionMode = "gpu-indirect";
    combinedIndirectPixel = await sampleSkin();
    renderer.submissionMode = "instanced";
    renderer.gpuLOD.enabled =
      renderer.gpuCompaction.enabled =
      renderer.gpuFrustum.enabled =
        false;
  }
  renderer.depthPrepass.enabled = true;
  const combinedDepthPixel = await sampleSkin();
  renderer.depthPrepass.enabled = false;
  const combinedPositions = new Float32Array(9);
  for (const [i, x, y] of [
    [0, -1.25, -1],
    [1, 0.75, -1],
    [2, -0.25, 1],
  ]) {
    combinedPositions[i * 3] = c * x + s * 0.5;
    combinedPositions[i * 3 + 1] = y;
    combinedPositions[i * 3 + 2] = -s * x + c * 0.5;
  }
  const combinedReference = renderer.meshes.upload({
    mode: 4,
    material: materialId,
    indices: new Uint32Array([0, 1, 2]),
    targets: [],
    attributes: {
      POSITION: combinedPositions,
      NORMAL: repeat([c * 0.125 + s * 0.95, -0.05, -s * 0.125 + c * 0.95]),
      TANGENT: repeat([c - s * 0.05, 0.05, -s - c * 0.05, 1]),
      TEXCOORD_0: new Float32Array([0.25, 0.5, 0.25, 0.5, 0.25, 0.5]),
      TEXCOORD_1: new Float32Array([0.75, 0.5, 0.75, 0.5, 0.75, 0.5]),
    },
  });
  rw.meshId[0] = combinedReference;
  rw.morphCounts[0] = rw.jointCounts[0] = 0;
  const combinedReferencePixel = await sampleSkin();

  rw.count = 1000;
  const combinedSamples = [],
    combinedResources = { ...renderer.resources.stats };
  for (let i = 0; i < 1000; i++) {
    rw.meshId[i] = morphMesh;
    rw.materialId[i] = materialId;
    rw.transformIndex[i] = i;
    rw.jointOffset[i] = 0;
    rw.jointCounts[i] = 2;
    rw.morphOffset[i] = morphState.weightOffset;
    rw.morphCounts[i] = 2;
    const o = i * 16;
    rw.matrices.fill(0, o, o + 16);
    rw.matrices[o] = rw.matrices[o + 5] = rw.matrices[o + 10] = 0.03;
    rw.matrices[o + 15] = 1;
    rw.matrices[o + 12] = ((i % 40) - 20) * 0.12;
    rw.matrices[o + 13] = (Math.floor(i / 40) - 12) * 0.12;
  }
  for (let frame = 0; frame < 12; frame++) {
    const enc = gpu.device.createCommandEncoder(),
      target = gpu.context.getCurrentTexture(),
      t = performance.now();
    renderer.encode(enc, target.createView({ format: gpu.renderFormat }));
    if (frame >= 2) combinedSamples.push(performance.now() - t);
    gpu.queue.submit([enc.finish()]);
    await gpu.queue.onSubmittedWorkDone();
  }
  combinedSamples.sort((a, b) => a - b);
  const combinedChecks = {
    medianCpuMs: combinedSamples[5],
    p95CpuMs: combinedSamples[9],
    stats: { ...renderer.stats },
    resourcesBefore: combinedResources,
    resourcesAfter: { ...renderer.resources.stats },
    pixel: combinedPixel,
    depthPixel: combinedDepthPixel,
    indirectPixel: combinedIndirectPixel,
    reference: combinedReferencePixel,
  };

  // Mesh bind bounds are offscreen, while joint-space deformation remains visible.
  app.world.transforms.setPosition(instances[1].meshEntity, 100, 0, 0);
  app.transformSystem.update(app.world.transforms);
  app.skeletonSystem.update(app.world, app.skeletons);
  app.animatedBounds.update(
    app.world,
    renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  for (const entity of rw.entityId.slice(0, rw.count))
    app.world.meshes.flags[entity] |= 1 << 16;
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  const boundsChecks = { results: {} };
  for (const mode of ["none", "linear", "bvh"]) {
    renderer.cullingEnabled = mode !== "none";
    renderer.visibilityMode = mode === "bvh" ? "bvh" : "linear";
    const pixel = await sampleSkin();
    boundsChecks.results[mode] = { pixel, stats: { ...renderer.stats } };
  }
  app.world.transforms.setPosition(rootJoint, 100, 0, 0);
  app.transformSystem.update(app.world.transforms);
  app.skeletonSystem.update(app.world, app.skeletons);
  app.animatedBounds.update(
    app.world,
    renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  boundsChecks.offscreen = {
    pixel: await sampleSkin(),
    stats: { ...renderer.stats },
  };
  boundsChecks.jointBoxes = app.animatedBounds.jointBoxes;

  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== app.defaultLightEntity)
      app.world.destroy(e);
  await app.loadAsset(new URL("/regression/blending.glb", location.href).href);
  const blending = app.animations.animators.at(-1);
  blending.loop = false;
  blending.play();
  blending.crossFade(1, 1);
  blending.update(0.5);
  const animatedEntity = app.skeletons.instances.at(-2).meshEntity,
    blendMorph =
      app.animations.morphStates[app.world.morphs.stateId[animatedEntity]];
  const blendingChecks = {
    position: app.world.transforms.positionX[animatedEntity],
    scale: app.world.transforms.scaleX[animatedEntity],
    rotation: app.world.transforms.rotationZ[animatedEntity],
    weight: blendMorph.weights[0],
    crossfading: blending.crossfading,
  };
  app.transformSystem.update(app.world.transforms);
  app.skeletonSystem.update(app.world, app.skeletons);
  app.animatedBounds.update(
    app.world,
    renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  await sampleSkin();

  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== app.defaultLightEntity)
      app.world.destroy(e);
  const lodEntity = app.world.create();
  app.world.transforms.add(lodEntity);
  app.world.meshes.set(lodEntity, 0, 0);
  app.world.bounds.setAABB(lodEntity, [-1, -1, -1], [1, 1, 1]);
  const medium = renderer.meshes.upload({
      mode: 4,
      material: 0,
      targets: [],
      attributes: {
        POSITION: new Float32Array([
          1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
        ]),
      },
      indices: new Uint32Array([
        0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5,
      ]),
    }),
    small = renderer.meshes.upload({
      mode: 4,
      material: 0,
      targets: [],
      attributes: {
        POSITION: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      },
      indices: new Uint32Array([0, 1, 2]),
    });
  const lodGroup = renderer.lodGroups.register(
    [0, medium, small],
    [400, 160, 80],
    renderer.meshes,
  );
  app.world.meshes.setLOD(lodEntity, lodGroup);
  app.transformSystem.update(app.world.transforms);
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  renderer.cullingEnabled = true;
  renderer.visibilityMode = "linear";
  const lodChecks = {
    results: [],
    resourcesBefore: { ...renderer.resources.stats },
  };
  for (const distance of [5, 20, 40, 80]) {
    renderer.camera.setPosition(0, 0, distance);
    await sampleSkin();
    lodChecks.results.push({
      distance,
      selection: rw.lodSelection[0],
      stats: { ...renderer.stats },
    });
  }
  lodChecks.resourcesAfter = { ...renderer.resources.stats };

  app.world.meshes.setLOD(lodEntity, -1);
  renderer.camera.setPosition(0, 0, 5);
  const light = app.defaultLightEntity,
    lightChecks = {
      results: {},
      resourcesBefore: { ...renderer.resources.stats },
    };
  const originalGroup = gpu.device.createBindGroup.bind(gpu.device);
  let lightGroups = 0;
  gpu.device.createBindGroup = (...args) => {
    lightGroups++;
    return originalGroup(...args);
  };
  for (const [name, props, z] of [
    ["ambient", { type: "directional", intensity: 0 }, 0],
    [
      "red",
      {
        type: "directional",
        intensity: 3,
        color: [1, 0, 0],
        direction: [0, 0, -1],
      },
      0,
    ],
    ["near", { type: "point", intensity: 3 }, 3],
    ["far", { type: "point", intensity: 3 }, 5],
    ["range", { type: "point", intensity: 3, range: 1 }, 3],
    ["spot", { type: "spot", intensity: 3, innerCone: 0.1, outerCone: 0.3 }, 3],
    [
      "spotAway",
      {
        type: "spot",
        intensity: 3,
        innerCone: 0.1,
        outerCone: 0.3,
        direction: [1, 0, 0],
      },
      3,
    ],
  ]) {
    app.world.lights.set(light, props);
    app.world.transforms.setPosition(light, 0, 0, z);
    app.transformSystem.update(app.world.transforms);
    app.extractor.extract(
      app.world,
      rw,
      app.skeletons,
      app.animations.morphPool,
    );
    lightChecks.results[name] = {
      pixel: await sampleSkin(),
      stats: { ...renderer.stats },
    };
  }
  app.world.lights.remove(light);
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  lightChecks.noLights = await sampleSkin();
  lightChecks.bindGroups = lightGroups;
  gpu.device.createBindGroup = originalGroup;
  lightChecks.resourcesAfter = { ...renderer.resources.stats };

  const manyLights = [];
  for (let i = 0; i < 1024; i++) {
    const e = app.world.create();
    app.world.transforms.add(e);
    app.world.transforms.setPosition(
      e,
      ((i % 32) - 16) * 1.5,
      ((Math.floor(i / 32) % 16) - 8) * 1.5,
      2 + Math.floor(i / 512) * 1.5,
    );
    manyLights.push(e);
  }
  const lightingBenchmark = {};
  for (const count of [1, 64, 256, 1024]) {
    for (let i = 0; i < manyLights.length; i++) {
      if (i < count)
        app.world.lights.set(manyLights[i], {
          type: "point",
          range: 1.5,
          intensity: 1,
        });
      else app.world.lights.remove(manyLights[i]);
    }
    app.transformSystem.update(app.world.transforms);
    app.extractor.extract(
      app.world,
      rw,
      app.skeletons,
      app.animations.morphPool,
    );
    const cpu = [],
      completion = [];
    for (let frame = 0; frame < 8; frame++) {
      const enc = gpu.device.createCommandEncoder(),
        texture = gpu.context.getCurrentTexture(),
        t = performance.now();
      renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
      const encoded = performance.now();
      gpu.queue.submit([enc.finish()]);
      await gpu.queue.onSubmittedWorkDone();
      if (frame >= 3) {
        cpu.push(encoded - t);
        completion.push(performance.now() - t);
      }
    }
    cpu.sort((a, b) => a - b);
    completion.sort((a, b) => a - b);
    lightingBenchmark[count] = {
      lights: count,
      cpuMedianMs: cpu[2],
      completionMedianMs: completion[2],
      completionP95Ms: completion[4],
    };
  }

  const captureClusters = async () => {
    const texture = gpu.context.getCurrentTexture(),
      enc = gpu.device.createCommandEncoder(),
      row = Math.ceil((texture.width * 4) / 256) * 256,
      rb = gpu.device.createBuffer({
        size: row * texture.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
    enc.copyTextureToBuffer({ texture }, { buffer: rb, bytesPerRow: row }, [
      texture.width,
      texture.height,
    ]);
    gpu.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(rb.getMappedRange()).slice();
    rb.unmap();
    rb.destroy();
    return bytes;
  };
  const compareImages = (a, b) => {
    let maxDifference = 0,
      differingBytes = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = Math.abs(a[i] - b[i]);
      maxDifference = Math.max(maxDifference, diff);
      if (diff) differingBytes++;
    }
    return { maxDifference, differingBytes };
  };
  const clusterResources = { ...renderer.resources.stats };
  renderer.clusters.mode = "off";
  const bruteImage = await captureClusters();
  renderer.clusters.mode = "on";
  const clusterImage = await captureClusters();
  const clusterChecks = {
    image: compareImages(bruteImage, clusterImage),
    timings: {},
  };
  for (const mode of ["off", "on"]) {
    renderer.clusters.mode = mode;
    const cpu = [],
      completion = [];
    for (let frame = 0; frame < 10; frame++) {
      const enc = gpu.device.createCommandEncoder(),
        texture = gpu.context.getCurrentTexture(),
        t = performance.now();
      renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
      const encoded = performance.now();
      gpu.queue.submit([enc.finish()]);
      await gpu.queue.onSubmittedWorkDone();
      if (frame >= 3) {
        cpu.push(encoded - t);
        completion.push(performance.now() - t);
      }
    }
    cpu.sort((a, b) => a - b);
    completion.sort((a, b) => a - b);
    clusterChecks.timings[mode] = {
      cpuMedianMs: cpu[3],
      completionMedianMs: completion[3],
      completionP95Ms: completion[6],
    };
  }
  const readClusters = async () => {
    const n =
        renderer.clusters.tilesX *
        renderer.clusters.tilesY *
        renderer.clusters.slices,
      rb = gpu.device.createBuffer({
        size: n * 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      enc = gpu.device.createCommandEncoder();
    enc.copyBufferToBuffer(renderer.clusters.counts, 0, rb, 0, n * 8);
    gpu.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(rb.getMappedRange());
    let sum = 0,
      max = 0,
      overflow = 0,
      invalidOffsets = 0;
    for (let i = 0; i < n; i++) {
      const count = data[i * 2 + 1];
      sum += count;
      max = Math.max(max, count);
      if (count > renderer.clusters.maxLights) overflow++;
      if (data[i * 2] !== i * renderer.clusters.maxLights) invalidOffsets++;
    }
    rb.unmap();
    rb.destroy();
    return {
      clusters: n,
      meanCandidates: sum / n,
      maxCandidates: max,
      overflowClusters: overflow,
      invalidOffsets,
    };
  };
  clusterChecks.metadata = await readClusters();
  for (let i = 0; i < manyLights.length; i++) {
    if (i < 65)
      app.world.lights.set(manyLights[i], {
        type: "directional",
        intensity: 0.01,
      });
    else app.world.lights.remove(manyLights[i]);
  }
  app.extractor.extract(app.world, rw, app.skeletons, app.animations.morphPool);
  renderer.clusters.mode = "off";
  const fullOverflow = await captureClusters();
  renderer.clusters.mode = "on";
  const safeOverflow = await captureClusters();
  clusterChecks.overflowImage = compareImages(fullOverflow, safeOverflow);
  clusterChecks.overflowMetadata = await readClusters();
  clusterChecks.resourcesBefore = clusterResources;
  clusterChecks.resourcesAfter = { ...renderer.resources.stats };
  renderer.shadows.cacheEnabled = false;
  // Phase 30 stage 1: a real receiver/caster image and alpha-masked depth.
  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== app.defaultLightEntity)
      app.world.destroy(e);
  app.world.transforms.setPosition(light, 0, 0, 0);
  app.world.lights.set(light, {
    type: "directional",
    intensity: 3,
    direction: [-1, -1, 0],
    castShadow: true,
  });
  renderer.clusters.mode = "off";
  renderer.camera.setPosition(3, 3, 5);
  renderer.camera.setTarget(0, 0, 0);
  const floorMaterial = app.materials.create({}),
    casterMaterial = app.materials.create({});
  const floorMesh = renderer.meshes.upload({
    attributes: {
      POSITION: new Float32Array([
        -4, -0.1, -4, 4, -0.1, -4, 4, -0.1, 4, -4, -0.1, 4,
      ]),
      NORMAL: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    },
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    mode: 4,
    material: 0,
    targets: [],
  });
  const floor = app.world.create(),
    caster = app.world.create();
  app.world.transforms.add(floor);
  app.world.meshes.set(floor, floorMesh, floorMaterial);
  app.world.bounds.setAABB(floor, [-4, -0.1, -4], [4, -0.1, 4]);
  app.world.transforms.add(caster);
  app.world.transforms.setPosition(caster, 0, 0.75, 0);
  app.world.transforms.setScale(caster, 0.5, 0.5, 0.5);
  app.world.meshes.set(caster, 0, casterMaterial);
  app.world.bounds.setAABB(caster, [-1, -1, -1], [1, 1, 1]);
  const extractShadows = () => {
    app.transformSystem.update(app.world.transforms);
    app.skeletonSystem.update(app.world, app.skeletons);
    app.animatedBounds.update(
      app.world,
      renderer.meshes,
      app.skeletons,
      app.animations.morphPool,
    );
    app.extractor.extract(
      app.world,
      rw,
      app.skeletons,
      app.animations.morphPool,
    );
  };
  extractShadows();
  const shadowSample = (bytes, p = [-1.1, -0.1, 0]) => {
    const m = renderer.camera.viewProjection,
      clip = [0, 0, 0, 0];
    for (let axis = 0; axis < 4; axis++)
      clip[axis] =
        m[axis] * p[0] + m[4 + axis] * p[1] + m[8 + axis] * p[2] + m[12 + axis];
    const x = Math.floor(((clip[0] / clip[3]) * 0.5 + 0.5) * gpu.canvas.width),
      y = Math.floor((0.5 - (clip[1] / clip[3]) * 0.5) * gpu.canvas.height),
      row = Math.ceil((gpu.canvas.width * 4) / 256) * 256;
    return Array.from(bytes.slice(y * row + x * 4, y * row + x * 4 + 4));
  };
  renderer.shadows.enabled = false;
  const litShadowPixel = shadowSample(await captureClusters());
  const shadowResources = { ...renderer.resources.stats };
  renderer.shadows.enabled = true;
  const shadowPixel = shadowSample(await captureClusters()),
    shadowStats = { ...renderer.stats };
  app.materials.set(casterMaterial, {
    baseColor: [1, 1, 1, 0.1],
    alphaMode: "MASK",
  });
  const maskedShadowPixel = shadowSample(await captureClusters());
  app.materials.set(casterMaterial, {});
  const shadowChecks = {
    litPixel: litShadowPixel,
    shadowPixel,
    maskedPixel: maskedShadowPixel,
    stats: shadowStats,
    resourcesBefore: shadowResources,
    resourcesAfter: { ...renderer.resources.stats },
    timings: {},
  };

  const rejectedCaster = app.world.create();
  app.world.transforms.add(rejectedCaster);
  app.world.transforms.setPosition(rejectedCaster, 100, 0.75, 0);
  app.world.meshes.set(rejectedCaster, 0, casterMaterial);
  app.world.bounds.setAABB(rejectedCaster, [-1, -1, -1], [1, 1, 1]);
  extractShadows();
  renderer.shadows.cullingEnabled = false;
  const uncullShadow = await captureClusters();
  shadowChecks.unculled = { ...renderer.stats };
  renderer.shadows.cullingEnabled = true;
  const culledShadow = await captureClusters();
  shadowChecks.culled = { ...renderer.stats };
  shadowChecks.cullingImage = compareImages(uncullShadow, culledShadow);

  const secondCaster = app.world.create();
  app.world.transforms.add(secondCaster);
  app.world.transforms.setPosition(secondCaster, 0, 0.75, 2);
  app.world.transforms.setScale(secondCaster, 0.5, 0.5, 0.5);
  app.world.meshes.set(secondCaster, 0, casterMaterial);
  app.world.bounds.setAABB(secondCaster, [-1, -1, -1], [1, 1, 1]);
  extractShadows();
  renderer.shadows.enabled = false;
  const multipleLit = await captureClusters();
  renderer.shadows.enabled = true;
  const multipleShadow = await captureClusters();
  shadowChecks.multipleCasters = {
    lit: shadowSample(multipleLit, [-1.5, -0.1, 2]),
    shadow: shadowSample(multipleShadow, [-1.5, -0.1, 2]),
    stats: { ...renderer.stats },
  };
  const secondLight = app.world.create();
  app.world.transforms.add(secondLight);
  app.world.lights.set(secondLight, {
    type: "directional",
    intensity: 3,
    direction: [1, -1, 0],
    castShadow: true,
  });
  extractShadows();
  await captureClusters();
  shadowChecks.multipleLights = {
    stats: { ...renderer.stats },
    ranges: Array.from(rw.lightData.slice(0, 32)).filter(
      (_, i) => i % 16 >= 14,
    ),
  };
  const multiCompletion = [];
  for (let f = 0; f < 8; f++) {
    const enc = gpu.device.createCommandEncoder(),
      texture = gpu.context.getCurrentTexture(),
      t = performance.now();
    renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
    gpu.queue.submit([enc.finish()]);
    await gpu.queue.onSubmittedWorkDone();
    if (f >= 3) multiCompletion.push(performance.now() - t);
  }
  multiCompletion.sort((a, b) => a - b);
  shadowChecks.multipleLights.completionMedianMs = multiCompletion[2];
  app.world.destroy(secondLight);
  app.world.destroy(secondCaster);
  extractShadows();
  // Combined GPU morph + skin shadow depth must match a static reference exactly.
  app.world.meshes.remove(caster);
  app.world.meshes.remove(rejectedCaster);
  extractShadows();
  const deformPositions = new Float32Array([
      1.5, 1, -0.5, 2.5, 1, -0.5, 2.5, 1, 0.5, 1.5, 1, 0.5,
    ]),
    deformNormal = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    deformIndices = new Uint32Array([0, 2, 1, 0, 3, 2]),
    joints = new Uint32Array(16),
    weights = new Float32Array([
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
    ]);
  const deformMesh = renderer.meshes.upload({
    mode: 4,
    material: 0,
    indices: deformIndices,
    targets: [
      {
        POSITION: new Float32Array([-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0]),
      },
    ],
    attributes: {
      POSITION: deformPositions,
      NORMAL: deformNormal,
      JOINTS_0: joints,
      WEIGHTS_0: weights,
    },
  });
  const referencePositions = deformPositions.slice();
  for (let i = 0; i < 4; i++) referencePositions[i * 3] -= 2;
  const shadowReferenceMesh = renderer.meshes.upload({
    mode: 4,
    material: 0,
    indices: deformIndices,
    targets: [],
    attributes: { POSITION: referencePositions, NORMAL: deformNormal },
  });
  const deformationEntity = app.world.create();
  app.world.transforms.add(deformationEntity);
  app.world.meshes.set(deformationEntity, deformMesh, casterMaterial);
  app.world.bounds.setAABB(deformationEntity, [-0.5, 1, -0.5], [0.5, 1, 0.5]);
  app.world.morphs.remove(deformationEntity);
  extractShadows();
  const deformationObject = Array.from(rw.entityId.slice(0, rw.count)).indexOf(
      deformationEntity,
    ),
    jointOffset = rw.jointCount,
    morphOffset = rw.morphWeightCount;
  rw.jointCount++;
  rw.jointMatrices.fill(0, jointOffset * 16, (jointOffset + 1) * 16);
  for (const k of [0, 5, 10, 15]) rw.jointMatrices[jointOffset * 16 + k] = 1;
  rw.jointMatrices[jointOffset * 16 + 12] = -1;
  rw.jointDirty[jointOffset] = 1;
  rw.morphWeightCount++;
  rw.morphWeights[morphOffset] = 1;
  rw.morphDirty[morphOffset] = 1;
  rw.jointOffset[deformationObject] = jointOffset;
  rw.jointCounts[deformationObject] = 1;
  rw.morphOffset[deformationObject] = morphOffset;
  rw.morphCounts[deformationObject] = 1;
  const deformedShadow = await captureClusters();
  rw.meshId[deformationObject] = shadowReferenceMesh;
  rw.jointCounts[deformationObject] = rw.morphCounts[deformationObject] = 0;
  const referenceShadow = await captureClusters();
  shadowChecks.deformation = compareImages(deformedShadow, referenceShadow);
  shadowChecks.deformedPixel = shadowSample(deformedShadow);
  shadowChecks.referencePixel = shadowSample(referenceShadow);
  app.world.destroy(deformationEntity);
  app.world.meshes.set(caster, 0, casterMaterial);
  app.world.meshes.set(rejectedCaster, 0, casterMaterial);
  extractShadows();

  const cascadeResources = { ...renderer.resources.stats };
  renderer.shadows.cascades = 4;
  const cascadeImage = await captureClusters();
  shadowChecks.cascades = {
    pixel: shadowSample(cascadeImage),
    stats: { ...renderer.stats },
    splits: Array.from(renderer.shadows.data).filter(
      (_, i) => i < 80 && i % 20 === 16,
    ),
    resourcesBefore: cascadeResources,
    resourcesAfter: { ...renderer.resources.stats },
  };
  const cascadeCompletion = [];
  for (let f = 0; f < 8; f++) {
    const enc = gpu.device.createCommandEncoder(),
      texture = gpu.context.getCurrentTexture(),
      t = performance.now();
    renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
    gpu.queue.submit([enc.finish()]);
    await gpu.queue.onSubmittedWorkDone();
    if (f >= 3) cascadeCompletion.push(performance.now() - t);
  }
  cascadeCompletion.sort((a, b) => a - b);
  shadowChecks.cascades.completionMedianMs = cascadeCompletion[2];
  renderer.shadows.cascades = 1;
  for (const enabled of [false, true]) {
    renderer.shadows.enabled = enabled;
    const cpu = [],
      completion = [];
    for (let f = 0; f < 8; f++) {
      const enc = gpu.device.createCommandEncoder(),
        texture = gpu.context.getCurrentTexture(),
        t = performance.now();
      renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
      cpu.push(performance.now() - t);
      gpu.queue.submit([enc.finish()]);
      await gpu.queue.onSubmittedWorkDone();
      if (f >= 3) completion.push(performance.now() - t);
    }
    cpu.sort((a, b) => a - b);
    completion.sort((a, b) => a - b);
    shadowChecks.timings[enabled ? "on" : "off"] = {
      cpuMedianMs: cpu[4],
      completionMedianMs: completion[2],
    };
  }

  renderer.shadows.enabled = true;
  renderer.shadows.cascades = 4;
  renderer.shadows.cacheEnabled = true;
  const cacheResources = { ...renderer.resources.stats };
  await captureClusters();
  const cachedImage = await captureClusters();
  shadowChecks.cache = {
    pixel: shadowSample(cachedImage),
    stats: { ...renderer.stats },
    resourcesBefore: cacheResources,
  };
  app.world.transforms.setPosition(caster, 3, 0.75, 0);
  extractShadows();
  const movedShadow = await captureClusters();
  shadowChecks.cache.moved = {
    pixel: shadowSample(movedShadow),
    stats: { ...renderer.stats },
  };
  app.world.transforms.setPosition(caster, 0, 0.75, 0);
  extractShadows();
  await captureClusters();
  app.materials.set(casterMaterial, {
    baseColor: [1, 1, 1, 0.1],
    alphaMode: "MASK",
  });
  const cacheMasked = await captureClusters();
  shadowChecks.cache.materialChanged = {
    pixel: shadowSample(cacheMasked),
    stats: { ...renderer.stats },
  };
  app.materials.set(casterMaterial, {});
  await captureClusters();
  const cacheCompletion = [];
  for (let f = 0; f < 8; f++) {
    const enc = gpu.device.createCommandEncoder(),
      texture = gpu.context.getCurrentTexture(),
      t = performance.now();
    renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
    gpu.queue.submit([enc.finish()]);
    await gpu.queue.onSubmittedWorkDone();
    if (f >= 3) cacheCompletion.push(performance.now() - t);
  }
  cacheCompletion.sort((a, b) => a - b);
  shadowChecks.cache.completionMedianMs = cacheCompletion[2];
  shadowChecks.cache.resourcesAfter = { ...renderer.resources.stats };

  const profilerResources = { ...renderer.resources.stats };
  renderer.shadows.cacheEnabled = false;
  renderer.clusters.mode = "on";
  renderer.gpuProfiler.enabled = true;
  for (let frame = 0; frame < 4; frame++) {
    const enc = gpu.device.createCommandEncoder(),
      texture = gpu.context.getCurrentTexture();
    renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
    gpu.queue.submit([enc.finish()]);
  }
  renderer.gpuProfiler.enabled = false;
  const gpuTimings = await renderer.gpuProfiler.readSamples();
  const profilingChecks = {
    supported: renderer.gpuProfiler.supported,
    gpuTimings,
    droppedCaptures: renderer.gpuProfiler.droppedCaptures,
    cpuFrames: app.profiler.frames,
    cpuStages: Array.from(app.profiler.history.slice(0, 9)),
    resourcesBefore: profilerResources,
    resourcesAfter: { ...renderer.resources.stats },
  };

  // Optional prepass is measured, not presumed beneficial.
  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== light) app.world.destroy(e);
  app.world.transforms.setPosition(light, 0, 0, 0);
  app.world.lights.set(light, {
    type: "directional",
    intensity: 3,
    direction: [0, 0, -1],
  });
  renderer.shadows.enabled = false;
  renderer.clusters.mode = "off";
  renderer.camera.setPosition(0, 0, 5);
  renderer.camera.setTarget(0, 0, 0);
  renderer.visibilityMode = "linear";
  const depthMaterial = app.materials.create({}),
    depthQuad = renderer.meshes.upload({
      mode: 4,
      material: 0,
      targets: [],
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      attributes: {
        POSITION: new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]),
        NORMAL: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      },
    });
  const depthChecks = {
      results: {},
      resourcesBefore: { ...renderer.resources.stats },
    },
    depthEntities = [];
  for (const [scenario, objectCount, lightCount] of [
    ["simple", 1, 1],
    ["overdraw", 32, 1],
    ["expensive", 32, 128],
  ]) {
    for (const e of depthEntities) app.world.destroy(e);
    depthEntities.length = 0;
    for (let i = 0; i < objectCount; i++) {
      const e = app.world.create();
      depthEntities.push(e);
      app.world.transforms.add(e);
      app.world.transforms.setPosition(e, 0, 0, i * 0.02);
      app.world.meshes.set(e, depthQuad, depthMaterial);
      app.world.bounds.setAABB(e, [-2, -2, 0], [2, 2, 0]);
    }
    for (let e = 0; e < app.world.nextEntity; e++)
      if (app.world.alive[e] && e !== light && app.world.lights.has[e])
        app.world.destroy(e);
    for (let i = 1; i < lightCount; i++) {
      const e = app.world.create();
      app.world.transforms.add(e);
      app.world.transforms.setPosition(
        e,
        ((i % 16) - 8) * 0.2,
        (Math.floor(i / 16) - 4) * 0.2,
        3,
      );
      app.world.lights.set(e, { type: "point", intensity: 0.01 });
    }
    extractShadows();
    const results = {};
    let reference;
    for (const enabled of [false, true]) {
      renderer.depthPrepass.enabled = enabled;
      const image = await captureClusters();
      if (!enabled) reference = image;
      else results.image = compareImages(reference, image);
      const cpu = [],
        completion = [];
      for (let f = 0; f < 8; f++) {
        const enc = gpu.device.createCommandEncoder(),
          texture = gpu.context.getCurrentTexture(),
          t = performance.now();
        renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
        cpu.push(performance.now() - t);
        gpu.queue.submit([enc.finish()]);
        await gpu.queue.onSubmittedWorkDone();
        if (f >= 3) completion.push(performance.now() - t);
      }
      cpu.sort((a, b) => a - b);
      completion.sort((a, b) => a - b);
      results[enabled ? "on" : "off"] = {
        cpuMedianMs: cpu[4],
        completionMedianMs: completion[2],
        stats: { ...renderer.stats },
      };
    }
    depthChecks.results[scenario] = results;
  }
  // Masked front geometry and transparent overlays preserve depth/blend semantics.
  const alphaMaterial = app.materials.create({
      baseColor: [1, 1, 1, 0.1],
      alphaMode: "MASK",
    }),
    blendMaterial = app.materials.create({
      baseColor: [0.2, 0.1, 0.3, 0.5],
      alphaMode: "BLEND",
    });
  app.world.meshes.materialId[depthEntities.at(-1)] = alphaMaterial;
  app.world.meshes.materialId[depthEntities.at(-2)] = blendMaterial;
  extractShadows();
  renderer.depthPrepass.enabled = false;
  const alphaWithoutDepth = await captureClusters();
  renderer.depthPrepass.enabled = true;
  const alphaWithDepth = await captureClusters();
  depthChecks.alpha = compareImages(alphaWithoutDepth, alphaWithDepth);
  depthChecks.resourcesAfter = { ...renderer.resources.stats };
  renderer.depthPrepass.enabled = false;

  renderer.hiz.enabled = true;
  renderer.depthPrepass.enabled = true;
  const hizResources = { ...renderer.resources.stats };
  await captureClusters();
  const readHiZ = async () => {
    const entries = [],
      enc = gpu.device.createCommandEncoder();
    let offset = 0;
    for (let level = 0; level < renderer.hiz.levels; level++) {
      const width = renderer.hiz.widths[level],
        height = renderer.hiz.heights[level],
        row = Math.ceil((width * 4) / 256) * 256;
      entries.push({ width, height, row, offset, level });
      offset += row * height;
    }
    const rb = gpu.device.createBuffer({
      size: offset,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    for (const item of entries)
      enc.copyTextureToBuffer(
        { texture: renderer.hiz.texture, mipLevel: item.level },
        { buffer: rb, offset: item.offset, bytesPerRow: item.row },
        [item.width, item.height],
      );
    gpu.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const raw = rb.getMappedRange(),
      mips = entries.map(({ width, height, row, offset }) => {
        const values = new Float32Array(width * height);
        for (let y = 0; y < height; y++)
          values.set(new Float32Array(raw, offset + y * row, width), y * width);
        return { width, height, values };
      });
    rb.unmap();
    rb.destroy();
    return mips;
  };
  const validateHiZ = (mips) => {
    let maxError = 0,
      checked = 0;
    for (let level = 1; level < mips.length; level++) {
      const source = mips[level - 1],
        destination = mips[level];
      for (let y = 0; y < destination.height; y++)
        for (let x = 0; x < destination.width; x++) {
          let maximum = 0;
          const x0 = Math.floor((x * source.width) / destination.width),
            x1 = Math.ceil(((x + 1) * source.width) / destination.width),
            y0 = Math.floor((y * source.height) / destination.height),
            y1 = Math.ceil(((y + 1) * source.height) / destination.height);
          for (let sy = y0; sy < y1; sy++)
            for (let sx = x0; sx < x1; sx++)
              maximum = Math.max(
                maximum,
                source.values[sy * source.width + sx],
              );
          maxError = Math.max(
            maxError,
            Math.abs(maximum - destination.values[y * destination.width + x]),
          );
          checked++;
        }
    }
    return {
      maxError,
      checked,
      levels: mips.map((m) => [m.width, m.height]),
      top: Array.from(mips.at(-1).values),
    };
  };
  const hizChecks = {
    main: validateHiZ(await readHiZ()),
    resourcesBefore: hizResources,
    timings: {},
  };
  for (const enabled of [false, true]) {
    renderer.hiz.enabled = enabled;
    const completion = [],
      cpu = [];
    for (let f = 0; f < 8; f++) {
      const enc = gpu.device.createCommandEncoder(),
        texture = gpu.context.getCurrentTexture(),
        t = performance.now();
      renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
      cpu.push(performance.now() - t);
      gpu.queue.submit([enc.finish()]);
      await gpu.queue.onSubmittedWorkDone();
      if (f >= 3) completion.push(performance.now() - t);
    }
    completion.sort((a, b) => a - b);
    cpu.sort((a, b) => a - b);
    hizChecks.timings[enabled ? "on" : "off"] = {
      completionMedianMs: completion[2],
      cpuMedianMs: cpu[4],
    };
  }
  renderer.hiz.enabled = true;
  renderer.gpuProfiler.enabled = true;
  for (let frame = 0; frame < 3; frame++) {
    const enc = gpu.device.createCommandEncoder(),
      texture = gpu.context.getCurrentTexture();
    renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
    gpu.queue.submit([enc.finish()]);
  }
  renderer.gpuProfiler.enabled = false;
  const hizSamples = await renderer.gpuProfiler.readSamples(),
    hizFrameTimes = {};
  for (const sample of hizSamples)
    if (sample.pass === 4)
      hizFrameTimes[sample.frame] =
        (hizFrameTimes[sample.frame] ?? 0) + sample.milliseconds;
  hizChecks.timestampFrameMs = Object.values(hizFrameTimes);
  hizChecks.resourcesAfter = { ...renderer.resources.stats };
  // Odd-sized source exercises complete edge footprints and maximum reduction.
  const oddDepth = gpu.device.createTexture({
      size: [5, 3],
      format: "depth32float",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }),
    oddView = oddDepth.createView();
  const oddShader = gpu.device.createShaderModule({
    code: `@vertex fn vs(@builtin(vertex_index) v:u32)->@builtin(position) vec4<f32>{let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[v],0,1);} @fragment fn fs(@builtin(position) p:vec4<f32>)->@builtin(frag_depth) f32{return .1+.05*floor(p.x)+.03*floor(p.y);}`,
  });
  const oddPipeline = gpu.device.createRenderPipeline({
    layout: "auto",
    vertex: { module: oddShader, entryPoint: "vs" },
    fragment: { module: oddShader, entryPoint: "fs", targets: [] },
    depthStencil: {
      format: "depth32float",
      depthWriteEnabled: true,
      depthCompare: "always",
    },
  });
  renderer.hiz.resize(5, 3, oddView);
  renderer.hiz.enabled = true;
  const oddEncoder = gpu.device.createCommandEncoder(),
    oddPass = oddEncoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: oddView,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
  oddPass.setPipeline(oddPipeline);
  oddPass.draw(3);
  oddPass.end();
  renderer.hiz.encode(oddEncoder);
  gpu.queue.submit([oddEncoder.finish()]);
  const oddMips = await readHiZ();
  hizChecks.odd = validateHiZ(oddMips);
  hizChecks.odd.mip0 = Array.from(oddMips[0].values);
  hizChecks.odd.mip1 = Array.from(oddMips[1].values);
  renderer.hiz.resize(gpu.canvas.width, gpu.canvas.height, renderer.depthView);
  oddDepth.destroy();
  renderer.hiz.enabled = false;
  renderer.hiz.debugEnabled = true;
  renderer.hiz.debugMip = renderer.hiz.levels - 1;
  const debugImage = await captureClusters();
  hizChecks.debugPixel = Array.from(debugImage.slice(0, 4));
  renderer.hiz.debugEnabled = false;
  renderer.depthPrepass.enabled = false;

  renderer.gpuFrustum.enabled = true;
  await captureClusters();
  const gpuVisibilityChecks = {
    resourcesBefore: { ...renderer.resources.stats },
    results: {},
  };
  const readVisibility = async (culler) => {
    const rb = gpu.device.createBuffer({
        size: Math.max(4, culler.count * 4),
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      enc = gpu.device.createCommandEncoder();
    enc.copyBufferToBuffer(
      culler.visibility,
      0,
      rb,
      0,
      Math.max(4, culler.count * 4),
    );
    gpu.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const flags = new Uint32Array(rb.getMappedRange()).slice(0, culler.count);
    rb.unmap();
    rb.destroy();
    return flags;
  };
  let localFlags = await readVisibility(renderer.gpuFrustum),
    localMismatches = 0;
  for (let i = 0; i < rw.count; i++)
    if (
      localFlags[i] !==
      Number(renderer.culler.intersects(rw, i, renderer.frustum, "sphere"))
    )
      localMismatches++;
  gpuVisibilityChecks.local = {
    count: rw.count,
    mismatches: localMismatches,
    stats: { ...renderer.stats },
  };
  await captureClusters();
  gpuVisibilityChecks.unchangedUploadBytes = renderer.gpuFrustum.uploadBytes;
  gpuVisibilityChecks.resourcesAfter = { ...renderer.resources.stats };
  renderer.gpuFrustum.enabled = false;
  const visibilityWorld = new rw.constructor(100000, 1, 1, 1),
    largeCuller = new renderer.gpuFrustum.constructor(
      gpu.device,
      renderer.resources,
      renderer.dynamic.buffers,
      100000,
    ),
    cpuCuller = new renderer.culler.constructor(100000);
  visibilityWorld.count = 100000;
  largeCuller.enabled = true;
  for (let i = 0; i < visibilityWorld.count; i++) {
    visibilityWorld.sphere[i * 4] = ((i % 100) - 50) * 2;
    visibilityWorld.sphere[i * 4 + 1] = ((Math.floor(i / 100) % 100) - 50) * 2;
    visibilityWorld.sphere[i * 4 + 2] = -Math.floor(i / 10000) * 10;
    visibilityWorld.sphere[i * 4 + 3] = 0.25;
    visibilityWorld.meshId[i] = 0;
    visibilityWorld.materialId[i] = depthMaterial;
    visibilityWorld.transformIndex[i] = i;
    visibilityWorld.flags[i] = i % 2;
  }
  const uploadStart = performance.now();
  largeCuller.update(visibilityWorld, gpu.queue);
  gpuVisibilityChecks.initialUploadMs = performance.now() - uploadStart;
  gpuVisibilityChecks.initialUploadBytes = largeCuller.uploadBytes;
  const largeResources = { ...renderer.resources.stats },
    largeCpu = [],
    largeCompletion = [],
    referenceFlags = new Uint32Array(visibilityWorld.count);
  for (let f = 0; f < 8; f++) {
    const t = performance.now();
    cpuCuller.cull(visibilityWorld, renderer.frustum, "sphere");
    if (f >= 3) largeCpu.push(performance.now() - t);
    const enc = gpu.device.createCommandEncoder(),
      start = performance.now();
    largeCuller.encode(enc, renderer.dynamic.frameSlot);
    gpu.queue.submit([enc.finish()]);
    await gpu.queue.onSubmittedWorkDone();
    if (f >= 3) largeCompletion.push(performance.now() - start);
  }
  for (let n = 0; n < cpuCuller.visibleObjects; n++)
    referenceFlags[cpuCuller.visible[n]] = 1;
  const gpuFlags = await readVisibility(largeCuller);
  let mismatches = 0,
    visibleCount = 0;
  for (let i = 0; i < gpuFlags.length; i++) {
    if (gpuFlags[i] !== referenceFlags[i]) mismatches++;
    visibleCount += gpuFlags[i];
  }
  largeCpu.sort((a, b) => a - b);
  largeCompletion.sort((a, b) => a - b);
  gpuVisibilityChecks.large = {
    count: 100000,
    visible: visibleCount,
    mismatches,
    cpuMedianMs: largeCpu[2],
    completionMedianMs: largeCompletion[2],
    resourcesBefore: largeResources,
    resourcesAfter: { ...renderer.resources.stats },
  };
  // Near/far/side-plane tangencies remain visible rather than risking false rejection.
  visibilityWorld.count = 5;
  visibilityWorld.sphere.set([
    0, 0, 4.9, 0, 0, 0, -95, 0, 0, 0, 5, 1, 100, 0, 0, 0, 0, 0, -96, 0,
  ]);
  largeCuller.update(visibilityWorld, gpu.queue);
  const boundaryEncoder = gpu.device.createCommandEncoder();
  largeCuller.encode(boundaryEncoder, renderer.dynamic.frameSlot);
  gpu.queue.submit([boundaryEncoder.finish()]);
  const boundaryFlags = await readVisibility(largeCuller);
  gpuVisibilityChecks.boundary = Array.from(boundaryFlags);
  largeCuller.dispose();

  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== light) app.world.destroy(e);
  app.world.lights.set(light, {
    type: "directional",
    intensity: 3,
    direction: [0, 0, -1],
  });
  renderer.gpuFrustum.enabled = true;
  renderer.gpuOcclusion.enabled = true;
  renderer.hiz.enabled = true;
  renderer.depthPrepass.enabled = false;
  const wall = app.world.create(),
    hiddenObject = app.world.create(),
    exposedObject = app.world.create();
  for (const e of [wall, hiddenObject, exposedObject])
    app.world.transforms.add(e);
  app.world.transforms.setPosition(wall, 0, 0, 1);
  app.world.meshes.set(wall, depthQuad, depthMaterial);
  app.world.bounds.setAABB(wall, [-2, -2, 0], [2, 2, 0]);
  for (const [e, x] of [
    [hiddenObject, 0],
    [exposedObject, 3.3],
  ]) {
    app.world.transforms.setPosition(e, x, 0, 0);
    app.world.transforms.setScale(e, 0.1, 0.1, 0.1);
    app.world.meshes.set(e, 0, depthMaterial);
    app.world.bounds.setAABB(e, [-1, -1, -1], [1, 1, 1]);
  }
  renderer.gpuOcclusion.resize(renderer.hiz.texture);
  extractShadows();
  const occlusionImage = await captureClusters(),
    occlusionFlags = await readVisibility(renderer.gpuFrustum);
  const occlusionChecks = {
    live: {
      ids: Array.from(rw.entityId.slice(0, rw.count)),
      flags: Array.from(occlusionFlags),
    },
    resourcesBefore: { ...renderer.resources.stats },
  };
  const depthMips = await readHiZ();
  const testWorld = new rw.constructor(100000, 1, 1, 1),
    testFrustum = new renderer.gpuFrustum.constructor(
      gpu.device,
      renderer.resources,
      renderer.dynamic.buffers,
      100000,
    ),
    testOcclusion = new renderer.gpuOcclusion.constructor(
      gpu.device,
      renderer.resources,
      renderer.dynamic.buffers,
      testFrustum,
    );
  testFrustum.enabled = testOcclusion.enabled = true;
  testOcclusion.resize(renderer.hiz.texture);
  testWorld.count = 6;
  testWorld.sphere.set([
    0, 0, 0, 0.2, 0, 0, 2, 0.2, 3.3, 0, 0, 0.2, 0, 0, 4.95, 0.15, 100, 0, 0,
    0.2, 0, 0, 0, 10,
  ]);
  testFrustum.update(testWorld, gpu.queue);
  const testEncoder = gpu.device.createCommandEncoder();
  testFrustum.encode(testEncoder, renderer.dynamic.frameSlot);
  testOcclusion.encode(testEncoder, renderer.dynamic.frameSlot);
  gpu.queue.submit([testEncoder.finish()]);
  occlusionChecks.boundary = Array.from(await readVisibility(testFrustum));
  // Independent CPU projection/Hi-Z reference; no actual vertex deformation or GPU readback in runtime.
  const occlusionReference = (world, id) => {
    if (!cpuCuller.intersects(world, id, renderer.frustum, "sphere")) return 0;
    const m = renderer.camera.viewProjection,
      v = renderer.camera.view,
      o = id * 4,
      c = world.sphere.slice(o, o + 3),
      r = world.sphere[o + 3],
      depth = -(v[2] * c[0] + v[6] * c[1] + v[10] * c[2] + v[14]);
    if (depth - r <= 0.1) return 1;
    let lo = [1, 1],
      hi = [0, 0],
      nearest = 1;
    for (let corner = 0; corner < 8; corner++) {
      const p = c.map((value, axis) => value + ((corner >> axis) & 1 ? r : -r)),
        clip = [0, 0, 0, 0];
      for (let axis = 0; axis < 4; axis++)
        clip[axis] =
          m[axis] * p[0] +
          m[4 + axis] * p[1] +
          m[8 + axis] * p[2] +
          m[12 + axis];
      if (clip[3] <= 0 || clip[2] <= 0) return 1;
      const uv = [
        (clip[0] / clip[3]) * 0.5 + 0.5,
        0.5 - (clip[1] / clip[3]) * 0.5,
      ];
      for (let axis = 0; axis < 2; axis++) {
        lo[axis] = Math.min(lo[axis], uv[axis]);
        hi[axis] = Math.max(hi[axis], uv[axis]);
      }
      nearest = Math.min(nearest, clip[2] / clip[3]);
    }
    lo = lo.map((x) => Math.max(0, Math.min(1, x)));
    hi = hi.map((x) => Math.max(0, Math.min(1, x)));
    const extent = Math.max(
        (hi[0] - lo[0]) * gpu.canvas.width,
        (hi[1] - lo[1]) * gpu.canvas.height,
      ),
      level = Math.min(
        depthMips.length - 1,
        Math.floor(Math.log2(Math.max(1, extent))),
      ),
      mip = depthMips[level],
      x0 = Math.min(mip.width - 1, Math.floor(lo[0] * mip.width)),
      x1 = Math.min(mip.width - 1, Math.floor(hi[0] * mip.width)),
      y0 = Math.min(mip.height - 1, Math.floor(lo[1] * mip.height)),
      y1 = Math.min(mip.height - 1, Math.floor(hi[1] * mip.height));
    let farthest = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        farthest = Math.max(farthest, mip.values[y * mip.width + x]);
    return Number(nearest <= farthest + 1e-4);
  };
  testWorld.count = 100000;
  for (let i = 0; i < testWorld.count; i++) {
    testWorld.sphere[i * 4] = ((i % 100) - 50) * 0.08;
    testWorld.sphere[i * 4 + 1] = ((Math.floor(i / 100) % 100) - 50) * 0.05;
    testWorld.sphere[i * 4 + 2] = -Math.floor(i / 10000) * 0.5;
    testWorld.sphere[i * 4 + 3] = 0.05;
  }
  testFrustum.update(testWorld, gpu.queue);
  const referenceStart = performance.now(),
    occlusionCPU = new Uint32Array(testWorld.count);
  for (let i = 0; i < testWorld.count; i++)
    occlusionCPU[i] = occlusionReference(testWorld, i);
  occlusionChecks.cpuReferenceMs = performance.now() - referenceStart;
  const occlusionSamples = [],
    occlusionResources = { ...renderer.resources.stats };
  for (let f = 0; f < 8; f++) {
    const enc = gpu.device.createCommandEncoder(),
      t = performance.now();
    testFrustum.encode(enc, renderer.dynamic.frameSlot);
    testOcclusion.encode(enc, renderer.dynamic.frameSlot);
    gpu.queue.submit([enc.finish()]);
    await gpu.queue.onSubmittedWorkDone();
    if (f >= 3) occlusionSamples.push(performance.now() - t);
  }
  occlusionSamples.sort((a, b) => a - b);
  const refined = await readVisibility(testFrustum);
  let occlusionMismatches = 0,
    falseInvisible = 0,
    occluded = 0;
  for (let i = 0; i < refined.length; i++) {
    if (refined[i] !== occlusionCPU[i]) occlusionMismatches++;
    if (!refined[i] && occlusionCPU[i]) falseInvisible++;
    if (!refined[i]) occluded++;
  }
  occlusionChecks.large = {
    count: testWorld.count,
    mismatches: occlusionMismatches,
    falseInvisible,
    occluded,
    completionMedianMs: occlusionSamples[2],
    resourcesBefore: occlusionResources,
    resourcesAfter: { ...renderer.resources.stats },
  };
  // Benchmark B uses the same 100,000 candidate spheres and camera for every method.
  const visibilityCPU = new renderer.culler.constructor(100000),
    visibilityBVH = new renderer.bvh.constructor(100000),
    enumeration = new Uint32Array(100000);
  testWorld.flags.fill(1 << 16);
  for (let i = 0; i < testWorld.count; i++)
    for (let axis = 0; axis < 3; axis++) {
      testWorld.boundsMin[i * 3 + axis] =
        testWorld.sphere[i * 4 + axis] - testWorld.sphere[i * 4 + 3];
      testWorld.boundsMax[i * 3 + axis] =
        testWorld.sphere[i * 4 + axis] + testWorld.sphere[i * 4 + 3];
    }
  let buildStart = performance.now();
  visibilityBVH.build(testWorld);
  const visibilityMatrix = {
    count: 100000,
    bvhBuildMs: performance.now() - buildStart,
  };
  const cpuVisibilityMeasure = (fn) => {
    const samples = [];
    let count = 0;
    for (let f = 0; f < 10; f++) {
      const t = performance.now();
      count = fn();
      if (f >= 5) samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    return { medianMs: samples[2], visible: count };
  };
  visibilityMatrix.noCulling = cpuVisibilityMeasure(() => {
    for (let i = 0; i < testWorld.count; i++) enumeration[i] = i;
    return testWorld.count;
  });
  visibilityMatrix.cpuFrustum = cpuVisibilityMeasure(() =>
    visibilityCPU.cull(testWorld, renderer.frustum, "sphere"),
  );
  const cpuSphereFlags = new Uint8Array(100000);
  for (let i = 0; i < visibilityCPU.visibleObjects; i++)
    cpuSphereFlags[visibilityCPU.visible[i]] = 1;
  visibilityMatrix.bvh = cpuVisibilityMeasure(() =>
    visibilityBVH.cull(testWorld, renderer.frustum, visibilityCPU),
  );
  const frustumSamples = [];
  for (let f = 0; f < 8; f++) {
    const encoder = gpu.device.createCommandEncoder(),
      start = performance.now();
    testFrustum.encode(encoder, renderer.dynamic.frameSlot);
    gpu.queue.submit([encoder.finish()]);
    await gpu.queue.onSubmittedWorkDone();
    if (f >= 3) frustumSamples.push(performance.now() - start);
  }
  const frustumOnly = await readVisibility(testFrustum);
  let frustumMatrixMismatch = 0,
    frustumMatrixVisible = 0;
  for (let i = 0; i < 100000; i++) {
    frustumMatrixVisible += frustumOnly[i];
    if (frustumOnly[i] !== cpuSphereFlags[i]) frustumMatrixMismatch++;
  }
  frustumSamples.sort((a, b) => a - b);
  visibilityMatrix.gpuFrustum = {
    completionMedianMs: frustumSamples[2],
    visible: frustumMatrixVisible,
    mismatches: frustumMatrixMismatch,
  };
  visibilityMatrix.gpuHiZ = {
    completionMedianMs: occlusionSamples[2],
    visible: 100000 - occluded,
    mismatches: occlusionMismatches,
  };
  const restoreVisibility = gpu.device.createCommandEncoder();
  testFrustum.encode(restoreVisibility, renderer.dynamic.frameSlot);
  testOcclusion.encode(restoreVisibility, renderer.dynamic.frameSlot);
  gpu.queue.submit([restoreVisibility.finish()]);
  await gpu.queue.onSubmittedWorkDone();
  await captureClusters();
  occlusionChecks.resourcesAfter = { ...renderer.resources.stats };

  const readCompacted = async (compactor, capacity) => {
    const rb = gpu.device.createBuffer({
        size: 256 + capacity * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      enc = gpu.device.createCommandEncoder();
    enc.copyBufferToBuffer(compactor.counter, 0, rb, 0, 16);
    enc.copyBufferToBuffer(
      compactor.visibleInstances,
      0,
      rb,
      256,
      capacity * 4,
    );
    gpu.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const bytes = rb.getMappedRange(),
      counter = new Uint32Array(bytes, 0, 4),
      result = {
        count: counter[0],
        overflow: counter[1],
        ids: new Uint32Array(
          bytes,
          256,
          Math.min(counter[0], capacity),
        ).slice(),
      };
    rb.unmap();
    rb.destroy();
    return result;
  };
  renderer.gpuCompaction.enabled = true;
  await captureClusters();
  const localCompacted = await readCompacted(
    renderer.gpuCompaction,
    renderer.gpuFrustum.capacity,
  );
  const compactionChecks = {
    local: {
      count: localCompacted.count,
      overflow: localCompacted.overflow,
      ids: Array.from(localCompacted.ids).sort((a, b) => a - b),
    },
    timings: {},
  };
  const compactLarge = new renderer.gpuCompaction.constructor(
    gpu.device,
    renderer.resources,
    testFrustum,
  );
  compactLarge.enabled = true;
  const sparseEnc = gpu.device.createCommandEncoder();
  compactLarge.encode(sparseEnc);
  gpu.queue.submit([sparseEnc.finish()]);
  const sparseCompacted = await readCompacted(compactLarge, 100000);
  let compactMismatches = 0;
  const compactSet = new Set(sparseCompacted.ids);
  for (let i = 0; i < 100000; i++)
    if (Number(compactSet.has(i)) !== refined[i]) compactMismatches++;
  compactionChecks.sparse = {
    count: sparseCompacted.count,
    overflow: sparseCompacted.overflow,
    unique: compactSet.size,
    mismatches: compactMismatches,
  };
  const compactResources = { ...renderer.resources.stats };
  for (const mode of ["sparse", "all"]) {
    if (mode === "all") {
      for (let i = 0; i < 100000; i++)
        testWorld.sphere.set([0, 0, 2, 0.01], i * 4);
      testFrustum.update(testWorld, gpu.queue);
      const enc = gpu.device.createCommandEncoder();
      testFrustum.encode(enc, renderer.dynamic.frameSlot);
      gpu.queue.submit([enc.finish()]);
    }
    const completion = [],
      cpu = [];
    for (let f = 0; f < 8; f++) {
      const enc = gpu.device.createCommandEncoder(),
        t = performance.now();
      compactLarge.encode(enc);
      cpu.push(performance.now() - t);
      gpu.queue.submit([enc.finish()]);
      await gpu.queue.onSubmittedWorkDone();
      if (f >= 3) completion.push(performance.now() - t);
    }
    completion.sort((a, b) => a - b);
    cpu.sort((a, b) => a - b);
    compactionChecks.timings[mode] = {
      completionMedianMs: completion[2],
      cpuMedianMs: cpu[4],
    };
  }
  const allCompacted = await readCompacted(compactLarge, 100000);
  compactionChecks.all = {
    count: allCompacted.count,
    overflow: allCompacted.overflow,
    unique: new Set(allCompacted.ids).size,
    minimum: Math.min(...allCompacted.ids),
    maximum: Math.max(...allCompacted.ids),
  };
  testWorld.count = 0;
  testFrustum.update(testWorld, gpu.queue);
  const emptyEnc = gpu.device.createCommandEncoder();
  compactLarge.encode(emptyEnc);
  gpu.queue.submit([emptyEnc.finish()]);
  const emptyCompacted = await readCompacted(compactLarge, 100000);
  compactionChecks.empty = {
    count: emptyCompacted.count,
    overflow: emptyCompacted.overflow,
  };
  compactionChecks.resourcesBefore = compactResources;
  compactionChecks.resourcesAfter = { ...renderer.resources.stats };
  renderer.gpuCompaction.enabled = false;
  testFrustum.dispose();
  renderer.gpuOcclusion.enabled = false;
  renderer.gpuFrustum.enabled = false;
  renderer.hiz.enabled = false;

  const indirectChecks = {
    supported: renderer.gpuDraws.supported,
    scenarios: {},
  };
  const readIndirect = async () => {
    const count = renderer.gpuDraws.batches.count,
      rb = gpu.device.createBuffer({
        size: Math.max(20, count * 20),
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      enc = gpu.device.createCommandEncoder();
    enc.copyBufferToBuffer(
      renderer.gpuDraws.arguments,
      0,
      rb,
      0,
      Math.max(20, count * 20),
    );
    gpu.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const words = new Uint32Array(rb.getMappedRange()),
      args = Array.from({ length: count }, (_, i) =>
        Array.from(words.slice(i * 5, i * 5 + 5)),
      );
    rb.unmap();
    rb.destroy();
    return args;
  };
  if (renderer.gpuDraws.supported) {
    renderer.hiz.enabled = false;
    renderer.depthPrepass.enabled = false;
    renderer.gpuOcclusion.enabled = false;
    renderer.gpuLOD.enabled =
      renderer.gpuCompaction.enabled =
      renderer.gpuFrustum.enabled =
        false;
    renderer.submissionMode = "instanced";
    const cpuWallImage = await captureClusters();
    renderer.submissionMode = "gpu-indirect";
    const gpuWallImage = await captureClusters();
    indirectChecks.scenarios.frustum = {
      image: compareImages(cpuWallImage, gpuWallImage),
      args: await readIndirect(),
      stats: { ...renderer.stats },
    };
    renderer.gpuOcclusion.enabled = true;
    const occludedIndirect = await captureClusters();
    indirectChecks.scenarios.occlusion = {
      image: compareImages(cpuWallImage, occludedIndirect),
      args: await readIndirect(),
      stats: { ...renderer.stats },
    };
    // GPU culling must preserve ordered alpha blending as well as masked depth.
    const transparentMaterial = app.materials.create({
        baseColor: [0.8, 0.1, 0.2, 0.5],
        alphaMode: "BLEND",
      }),
      maskIndirectMaterial = app.materials.create({
        baseColor: [1, 1, 1, 0.1],
        alphaMode: "MASK",
      });
    app.world.meshes.materialId[exposedObject] = transparentMaterial;
    app.world.meshes.materialId[hiddenObject] = maskIndirectMaterial;
    const transparentSecond = app.world.create();
    app.world.transforms.add(transparentSecond);
    app.world.transforms.setPosition(transparentSecond, 3.3, 0, 0.25);
    app.world.transforms.setScale(transparentSecond, 0.1, 0.1, 0.1);
    app.world.meshes.set(transparentSecond, 0, transparentMaterial);
    app.world.bounds.setAABB(transparentSecond, [-1, -1, -1], [1, 1, 1]);
    extractShadows();
    renderer.submissionMode = "instanced";
    renderer.gpuOcclusion.enabled = false;
    renderer.gpuLOD.enabled =
      renderer.gpuCompaction.enabled =
      renderer.gpuFrustum.enabled =
        false;
    renderer.hiz.enabled = false;
    renderer.depthPrepass.enabled = false;
    const directAlphaImage = await captureClusters();
    renderer.submissionMode = "gpu-indirect";
    renderer.gpuOcclusion.enabled = true;
    const indirectAlphaImage = await captureClusters();
    indirectChecks.alpha = {
      image: compareImages(directAlphaImage, indirectAlphaImage),
      args: await readIndirect(),
    };
    // 10,000 cubes: full frame CPU submission and GPU completion, all pipeline stages included.
    const resources = { ...renderer.resources.stats };
    renderer.gpuOcclusion.enabled = false;
    renderer.hiz.enabled = false;
    renderer.depthPrepass.enabled = false;
    rw.count = 10000;
    rw.lightCount = 1;
    rw.lodGroup.fill(-1, 0, 10000);
    rw.jointCounts.fill(0, 0, 10000);
    rw.morphCounts.fill(0, 0, 10000);
    for (let i = 0; i < 10000; i++) {
      const x = ((i % 100) - 50) * 0.09,
        y = (Math.floor(i / 100) - 50) * 0.09,
        o = i * 16;
      rw.entityId[i] = i;
      rw.transformIndex[i] = i;
      rw.meshId[i] = 0;
      rw.materialId[i] = depthMaterial;
      rw.flags[i] = 0;
      rw.matrices.fill(0, o, o + 16);
      rw.matrices[o] = rw.matrices[o + 5] = rw.matrices[o + 10] = 0.03;
      rw.matrices[o + 15] = 1;
      rw.matrices[o + 12] = x;
      rw.matrices[o + 13] = y;
      rw.sphere.set([x, y, 0, 0.09], i * 4);
      rw.boundsMin.set([x - 0.03, y - 0.03, -0.03], i * 3);
      rw.boundsMax.set([x + 0.03, y + 0.03, 0.03], i * 3);
    }
    indirectChecks.timings = {};
    let directCubeImage;
    for (const mode of ["instanced", "gpu-indirect"]) {
      renderer.submissionMode = mode;
      if (mode === "instanced")
        renderer.gpuLOD.enabled =
          renderer.gpuCompaction.enabled =
          renderer.gpuFrustum.enabled =
            false;
      const image = await captureClusters();
      if (mode === "instanced") directCubeImage = image;
      else indirectChecks.cubesImage = compareImages(directCubeImage, image);
      const cpu = [],
        completion = [];
      for (let frame = 0; frame < 12; frame++) {
        const enc = gpu.device.createCommandEncoder(),
          texture = gpu.context.getCurrentTexture(),
          t = performance.now();
        renderer.encode(enc, texture.createView({ format: gpu.renderFormat }));
        cpu.push(performance.now() - t);
        gpu.queue.submit([enc.finish()]);
        await gpu.queue.onSubmittedWorkDone();
        if (frame >= 4) completion.push(performance.now() - t);
      }
      cpu.sort((a, b) => a - b);
      completion.sort((a, b) => a - b);
      indirectChecks.timings[mode] = {
        cpuMedianMs: cpu[6],
        completionMedianMs: completion[4],
        stats: { ...renderer.stats },
      };
    }
    indirectChecks.cubeArgs = await readIndirect();
    indirectChecks.resourcesBefore = resources;
    indirectChecks.resourcesAfter = { ...renderer.resources.stats };
    renderer.camera.setPosition(100, 0, 5);
    renderer.camera.setTarget(100, 0, 0);
    await captureClusters();
    indirectChecks.offscreenArgs = await readIndirect();
    renderer.camera.setPosition(0, 0, 5);
    renderer.camera.setTarget(0, 0, 0);
    renderer.submissionMode = "instanced";
    renderer.gpuFrustum.enabled = renderer.gpuCompaction.enabled = false;
  }

  const readLOD = async (selector, count) => {
    const rb = gpu.device.createBuffer({
        size: Math.max(4, count * 8) + 32,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      enc = gpu.device.createCommandEncoder();
    if (count) {
      enc.copyBufferToBuffer(selector.selections, 0, rb, 0, count * 4);
      enc.copyBufferToBuffer(
        selector.selectedMeshes,
        0,
        rb,
        count * 4,
        count * 4,
      );
    }
    enc.copyBufferToBuffer(selector.distribution, 0, rb, count * 8, 32);
    gpu.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const raw = rb.getMappedRange(),
      result = {
        selections: new Int32Array(raw, 0, count).slice(),
        meshes: new Uint32Array(raw, count * 4, count).slice(),
        distribution: Array.from(new Uint32Array(raw, count * 8, 8)),
      };
    rb.unmap();
    rb.destroy();
    return result;
  };
  const gpuLODChecks = { results: [], hysteresis: [] };
  if (renderer.gpuDraws.supported) {
    for (let e = 0; e < app.world.nextEntity; e++)
      if (app.world.alive[e] && e !== light) app.world.destroy(e);
    const gpuLODEntity = app.world.create();
    app.world.transforms.add(gpuLODEntity);
    app.world.meshes.set(gpuLODEntity, 0, depthMaterial);
    app.world.meshes.setLOD(gpuLODEntity, lodGroup);
    app.world.bounds.setAABB(gpuLODEntity, [-1, -1, -1], [1, 1, 1]);
    extractShadows();
    renderer.camera.setTarget(0, 0, 0);
    renderer.gpuOcclusion.enabled =
      renderer.hiz.enabled =
      renderer.depthPrepass.enabled =
        false;
    const lodResources = { ...renderer.resources.stats };
    for (const distance of [5, 20, 40, 80]) {
      renderer.camera.setPosition(0, 0, distance);
      renderer.submissionMode = "gpu-indirect";
      const gpuImage = await captureClusters(),
        selection = await readLOD(renderer.gpuLOD, 1),
        args = await readIndirect();
      renderer.submissionMode = "instanced";
      renderer.gpuLOD.enabled =
        renderer.gpuCompaction.enabled =
        renderer.gpuFrustum.enabled =
          false;
      const cpuImage = await captureClusters();
      gpuLODChecks.results.push({
        distance,
        level: selection.selections[0],
        mesh: selection.meshes[0],
        distribution: selection.distribution,
        args,
        image: compareImages(cpuImage, gpuImage),
      });
    }
    for (const pixels of [470, 390, 330, 410, 470]) {
      const radius = rw.sphere[3],
        distance =
          radius +
          (radius * renderer.camera.projection[5] * gpu.canvas.height) / pixels;
      renderer.camera.setPosition(0, 0, distance);
      renderer.submissionMode = "gpu-indirect";
      await captureClusters();
      gpuLODChecks.hysteresis.push(
        (await readLOD(renderer.gpuLOD, 1)).selections[0],
      );
    }
    gpuLODChecks.resourcesBefore = lodResources;
    gpuLODChecks.resourcesAfter = { ...renderer.resources.stats };
    renderer.submissionMode = "instanced";
    renderer.gpuLOD.enabled =
      renderer.gpuCompaction.enabled =
      renderer.gpuFrustum.enabled =
        false;
    renderer.camera.setPosition(0, 0, 20);
    await captureClusters();
  }

  if (renderer.gpuDraws.supported) {
    for (let e = 0; e < app.world.nextEntity; e++)
      if (app.world.alive[e] && e !== light) app.world.destroy(e);
    const stream = (v, count) =>
        new Float32Array(Array.from({ length: count }, () => v).flat()),
      makeMorphLOD = (positions, indices) => {
        const n = positions.length / 3;
        return renderer.meshes.upload({
          mode: 4,
          material: 0,
          indices: new Uint32Array(indices),
          targets: [
            {
              POSITION: stream([0, 0, 0.5], n),
              NORMAL: stream([0.25, 0, -0.1], n),
              TANGENT: stream([0, 0.1, 0], n),
            },
            {
              POSITION: stream([0.25, 0, 0], n),
              NORMAL: stream([0, 0.1, 0], n),
              TANGENT: stream([0, 0, 0.2], n),
            },
          ],
          attributes: {
            POSITION: new Float32Array(positions),
            NORMAL: stream([0, 0, 1], n),
            TANGENT: stream([1, 0, 0, 1], n),
            JOINTS_0: new Uint32Array(n * 4),
            WEIGHTS_0: stream([1, 0, 0, 0], n),
          },
        });
      };
    const morphLODBase = makeMorphLOD(
        [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
        [0, 1, 2, 0, 2, 3],
      ),
      morphLODVariant = makeMorphLOD([-1, -1, 0, 1, -1, 0, 0, 1, 0], [0, 1, 2]),
      morphLODGroup = renderer.lodGroups.register(
        [morphLODBase, morphLODVariant],
        [500, 10],
        renderer.meshes,
      ),
      morphLODEntity = app.world.create(),
      morphLODState = app.animations.morphPool.create(2, [0.5, -0.25]);
    app.world.transforms.add(morphLODEntity);
    app.world.meshes.set(morphLODEntity, morphLODBase, depthMaterial);
    app.world.meshes.setLOD(morphLODEntity, morphLODGroup);
    app.world.bounds.setAABB(morphLODEntity, [-1, -1, 0], [1, 1, 0]);
    app.world.morphs.add(morphLODEntity);
    app.world.morphs.stateId[morphLODEntity] = morphLODState;
    extractShadows();
    renderer.camera.setPosition(0, 0, 20);
    renderer.submissionMode = "gpu-indirect";
    renderer.gpuOcclusion.enabled =
      renderer.hiz.enabled =
      renderer.depthPrepass.enabled =
        false;
    const gpuMorphLODImage = await captureClusters(),
      gpuMorphLOD = await readLOD(renderer.gpuLOD, 1);
    renderer.submissionMode = "instanced";
    renderer.gpuLOD.enabled =
      renderer.gpuCompaction.enabled =
      renderer.gpuFrustum.enabled =
        false;
    const cpuMorphLODImage = await captureClusters();
    gpuLODChecks.morph = {
      image: compareImages(cpuMorphLODImage, gpuMorphLODImage),
      level: gpuMorphLOD.selections[0],
      baseVertices: renderer.meshes.get(morphLODBase).morph.vertexCount,
      selectedVertices: renderer.meshes.get(morphLODVariant).morph.vertexCount,
    };
    renderer.submissionMode = "gpu-indirect";
    renderer.gpuOcclusion.enabled = true;
    const conservativeLODDepth = await captureClusters();
    gpuLODChecks.conservativeDepth = {
      image: compareImages(cpuMorphLODImage, conservativeLODDepth),
      stats: { ...renderer.stats },
    };
    app.world.destroy(morphLODEntity);
    const lodAlphaFront = app.materials.create({
        baseColor: [0.8, 0.1, 0.2, 0.5],
        alphaMode: "BLEND",
      }),
      lodAlphaBack = app.materials.create({
        baseColor: [0.1, 0.1, 0.8, 0.5],
        alphaMode: "BLEND",
      });
    for (const [scale, z, material] of [
      [2, 0.5, lodAlphaFront],
      [0.2, 0, lodAlphaBack],
    ]) {
      const e = app.world.create();
      app.world.transforms.add(e);
      app.world.transforms.setScale(e, scale, scale, scale);
      app.world.transforms.setPosition(e, 0, 0, z);
      app.world.meshes.set(e, morphLODBase, material);
      app.world.meshes.setLOD(e, morphLODGroup);
      app.world.bounds.setAABB(e, [-1, -1, 0], [1, 1, 0]);
    }
    extractShadows();
    renderer.gpuOcclusion.enabled =
      renderer.hiz.enabled =
      renderer.depthPrepass.enabled =
        false;
    renderer.submissionMode = "gpu-indirect";
    const gpuAlphaLOD = await captureClusters(),
      alphaLODSelections = await readLOD(renderer.gpuLOD, 2);
    renderer.submissionMode = "instanced";
    renderer.gpuLOD.enabled =
      renderer.gpuCompaction.enabled =
      renderer.gpuFrustum.enabled =
        false;
    const cpuAlphaLOD = await captureClusters();
    gpuLODChecks.alpha = {
      image: compareImages(cpuAlphaLOD, gpuAlphaLOD),
      levels: Array.from(alphaLODSelections.selections),
    };
  }
  // Temporal assumptions are valid only for exact stable camera/scene snapshots.
  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== light) app.world.destroy(e);
  const captureTemporal = async () => {
    extractShadows();
    return captureClusters();
  };
  renderer.submissionMode = "gpu-indirect";
  renderer.camera.setPosition(0, 0, 5);
  renderer.camera.setTarget(0, 0, 0);
  const temporalWall = app.world.create(),
    temporalRear = app.world.create();
  for (const entity of [temporalWall, temporalRear]) {
    app.world.transforms.add(entity);
    app.world.meshes.set(entity, 0, depthMaterial);
    app.world.bounds.setAABB(entity, [-1, -1, -1], [1, 1, 1]);
  }
  app.world.meshes.set(temporalWall, depthQuad, depthMaterial);
  app.world.bounds.setAABB(temporalWall, [-2, -2, 0], [2, 2, 0]);
  app.world.transforms.setPosition(temporalWall, 0, 0, 1);
  app.world.transforms.setScale(temporalRear, 0.1, 0.1, 0.1);
  app.world.transforms.setPosition(temporalRear, 0, 0, 0);
  renderer.gpuOcclusion.enabled = true;
  renderer.temporal.enabled = false;
  const temporalBaseline = await captureTemporal();
  renderer.temporal.enabled = true;
  const temporalFirst = await captureTemporal(),
    temporalFirstFlags = Array.from(await readVisibility(renderer.gpuFrustum));
  await captureTemporal();
  const temporalFreshFlags = Array.from(
    await readVisibility(renderer.gpuFrustum),
  );
  const temporalStable = await captureTemporal();
  const temporalChecks = {
    firstImage: compareImages(temporalFirst, temporalBaseline),
    firstFlags: temporalFirstFlags,
    freshFlags: temporalFreshFlags,
    stableFlags: Array.from(await readVisibility(renderer.gpuFrustum)),
    stableImage: compareImages(temporalStable, temporalBaseline),
    reused: renderer.temporal.reuse,
    dispatches: renderer.gpuOcclusion.dispatches,
  };
  const newHidden = app.world.create();
  app.world.transforms.add(newHidden);
  app.world.meshes.set(newHidden, 0, depthMaterial);
  app.world.bounds.setAABB(newHidden, [-1, -1, -1], [1, 1, 1]);
  app.world.transforms.setPosition(newHidden, 0, 0, -1);
  app.world.transforms.setScale(newHidden, 0.1, 0.1, 0.1);
  await captureTemporal();
  temporalChecks.spawn = {
    flags: Array.from(await readVisibility(renderer.gpuFrustum)),
    reuse: renderer.temporal.reuse,
    newObjects: renderer.temporal.newObjects,
  };
  await captureTemporal();
  await captureTemporal();
  renderer.camera.setPosition(1, 0, 5);
  await captureTemporal();
  temporalChecks.cameraReset = !renderer.temporal.reuse;
  renderer.camera.setTarget(20, 0, 5);
  await captureTemporal();
  temporalChecks.rotationReset = !renderer.temporal.reuse;
  renderer.camera.setPosition(0, 0, 5);
  renderer.camera.setTarget(0, 0, 0);
  await captureTemporal();
  await captureTemporal();
  app.world.transforms.setPosition(temporalRear, 8, 0, -5);
  await captureTemporal();
  temporalChecks.motionReset = !renderer.temporal.reuse;
  const temporalResources = { ...renderer.resources.stats };
  const measureTemporal = async (enabled) => {
    renderer.temporal.enabled = enabled;
    const timings = [];
    for (let f = 0; f < 10; f++) {
      const t = performance.now();
      await captureTemporal();
      if (f >= 5) timings.push(performance.now() - t);
    }
    timings.sort((a, b) => a - b);
    return timings[2];
  };
  temporalChecks.readbackInclusiveMedianMs = {
    off: await measureTemporal(false),
    on: await measureTemporal(true),
  };
  temporalChecks.resourcesBefore = temporalResources;
  temporalChecks.resourcesAfter = { ...renderer.resources.stats };
  renderer.temporal.enabled = false;
  renderer.gpuOcclusion.enabled = false;
  // Stream slots retain numeric assets; detachment precedes fenced eviction.
  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== light) app.world.destroy(e);
  const streamedEntity = app.world.create();
  app.world.transforms.add(streamedEntity);
  app.world.meshes.set(streamedEntity, 0, depthMaterial);
  app.world.meshes.setLOD(streamedEntity, lodGroup);
  app.world.bounds.setAABB(streamedEntity, [-1, -1, -1], [1, 1, 1]);
  renderer.camera.setPosition(0, 0, 20);
  renderer.camera.setTarget(0, 0, 0);
  renderer.hiz.enabled = renderer.depthPrepass.enabled = false;
  const streamCapture = async () => {
    extractShadows();
    return captureClusters();
  };
  const streamFallback = await streamCapture(),
    streamingBefore = { ...renderer.resources.stats };
  const triangleAsset = app.assetLoader.get(
    "/regression/triangle.glb?async-check",
  ).decoded;
  let tStream = performance.now();
  await renderer.streaming.bindLOD(
    lodGroup,
    1,
    "triangle",
    async () => triangleAsset.meshes[0].primitives[0],
  );
  const streamingChecks = { lodLoadMs: performance.now() - tStream };
  const streamedMesh = renderer.lodGroups.entries[lodGroup].meshes[1];
  const streamedImage = await streamCapture(),
    streamedArgs = await readIndirect();
  streamingChecks.lod = {
    mesh: streamedMesh,
    indexCount: renderer.meshes.get(streamedMesh).indexCount,
    arguments: streamedArgs,
    references:
      renderer.streaming.resources.records.get("mesh:triangle").references,
    protectedEvictions: await renderer.streaming.evictUnused(1),
  };
  renderer.streaming.releaseLOD(lodGroup, 1);
  const restoredImage = await streamCapture();
  await streamCapture();
  tStream = performance.now();
  streamingChecks.lodEvictions = await renderer.streaming.evictUnused(1);
  streamingChecks.lodEvictionMs = performance.now() - tStream;
  streamingChecks.lodRestored = compareImages(streamFallback, restoredImage);
  streamingChecks.resourcesBefore = streamingBefore;
  streamingChecks.afterLOD = { ...renderer.resources.stats };
  let missing = false;
  try {
    renderer.meshes.get(streamedMesh);
  } catch {
    missing = true;
  }
  streamingChecks.evictedMeshUnavailable = missing;
  const imageCanvas = new OffscreenCanvas(8, 8),
    streamContext = imageCanvas.getContext("2d");
  streamContext.fillStyle = "rgb(13,42,84)";
  streamContext.fillRect(0, 0, 8, 8);
  const streamPng = new Uint8Array(
    await (
      await imageCanvas.convertToBlob({ type: "image/png" })
    ).arrayBuffer(),
  );
  const pbrAsset = app.assetLoader.get(
    new URL("/regression/pbr.glb", location.href).href,
  ).decoded;
  const textureAsset = {
    ...pbrAsset,
    materials: [
      {
        ...pbrAsset.materials[0],
        textures: {
          baseColor: {
            texture: 0,
            texCoord: 0,
            magFilter: 9729,
            minFilter: 9987,
            wrapS: 10497,
            wrapT: 10497,
          },
        },
      },
    ],
    textures: [{ name: "streamed", mimeType: "image/png", image: streamPng }],
  };
  tStream = performance.now();
  await renderer.streaming.bindMaterial(
    depthMaterial,
    "blue",
    async () => textureAsset,
  );
  streamingChecks.textureLoadMs = performance.now() - tStream;
  const textureImage = await streamCapture();
  streamingChecks.textureDifference = compareImages(
    textureImage,
    restoredImage,
  );
  const spareMaterial = app.materials.create();
  await renderer.streaming.bindMaterial(
    spareMaterial,
    "blue",
    async () => textureAsset,
  );
  renderer.streaming.releaseMaterial(depthMaterial);
  await streamCapture();
  streamingChecks.sharedReferences =
    renderer.streaming.resources.records.get("texture:blue").references;
  streamingChecks.sharedProtectedEvictions =
    await renderer.streaming.evictUnused(1);
  renderer.streaming.releaseMaterial(spareMaterial);
  const textureRestored = await streamCapture();
  await streamCapture();
  tStream = performance.now();
  streamingChecks.textureEvictions = await renderer.streaming.evictUnused(1);
  streamingChecks.textureEvictionMs = performance.now() - tStream;
  streamingChecks.textureRestored = compareImages(
    textureRestored,
    restoredImage,
  );
  streamingChecks.resourcesAfter = { ...renderer.resources.stats };
  // Native BC1 KTX2 preserves authored mip blocks and matches an RGBA source.
  const compressedChecks = {
    supported: gpu.device.features.has("texture-compression-bc"),
    features: Array.from(gpu.device.features),
  };
  if (compressedChecks.supported) {
    const nativeBytes = new Uint8Array(
      await (await fetch("/regression/native-bc1.ktx2")).arrayBuffer(),
    );
    const nativeAsset = {
      ...textureAsset,
      textures: [
        { name: "nativeBC", mimeType: "image/ktx2", image: nativeBytes },
      ],
    };
    const nativeStart = performance.now();
    await renderer.streaming.bindMaterial(
      depthMaterial,
      "nativeBC",
      async () => nativeAsset,
    );
    compressedChecks.coldMs = performance.now() - nativeStart;
    const nativeImage = await streamCapture();
    let nativeGPU;
    for (const pending of renderer.textures.cache.values()) {
      const texture = await pending;
      if (texture.label === "nativeBC") nativeGPU = texture;
    }
    compressedChecks.format = nativeGPU.format;
    compressedChecks.mips = nativeGPU.mipLevelCount;
    const nativeRB = gpu.device.createBuffer({
        size: 4 * 512,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      nativeCommands = gpu.device.createCommandEncoder();
    for (let mip = 0; mip < 4; mip++) {
      const size = mip === 0 ? 8 : 4;
      nativeCommands.copyTextureToBuffer(
        { texture: nativeGPU, mipLevel: mip },
        { buffer: nativeRB, offset: mip * 512, bytesPerRow: 256 },
        [size, size],
      );
    }
    gpu.queue.submit([nativeCommands.finish()]);
    await nativeRB.mapAsync(GPUMapMode.READ);
    const nativeRaw = new Uint8Array(nativeRB.getMappedRange());
    compressedChecks.mipBlocks = Array.from({ length: 4 }, (_, mip) =>
      Array.from(nativeRaw.slice(mip * 512, mip * 512 + 8)),
    );
    nativeRB.unmap();
    nativeRB.destroy();
    renderer.streaming.releaseMaterial(depthMaterial);
    streamContext.fillStyle = "rgb(255,0,0)";
    streamContext.fillRect(0, 0, 8, 8);
    const redPng = new Uint8Array(
      await (
        await imageCanvas.convertToBlob({ type: "image/png" })
      ).arrayBuffer(),
    );
    const redAsset = {
      ...textureAsset,
      textures: [{ name: "redRGBA", mimeType: "image/png", image: redPng }],
    };
    const pngStart = performance.now();
    await renderer.streaming.bindMaterial(
      depthMaterial,
      "redRGBA",
      async () => redAsset,
    );
    compressedChecks.pngColdMs = performance.now() - pngStart;
    compressedChecks.image = compareImages(nativeImage, await streamCapture());
    const warmStart = performance.now();
    const warmNativeGroups = await renderer.textures.prepare(nativeAsset);
    compressedChecks.cachedMs = performance.now() - warmStart;
    await gpu.queue.onSubmittedWorkDone();
    await renderer.textures.release(warmNativeGroups);
    renderer.streaming.releaseMaterial(depthMaterial);
    await streamCapture();
    await streamCapture();
    await renderer.streaming.evictUnused(1);
    compressedChecks.compressedMipBytes = 56;
    compressedChecks.rgbaMipBytes = 340;
  }
  // A streamed alpha mask changes occluders without moving objects or the camera.
  for (let e = 0; e < app.world.nextEntity; e++)
    if (app.world.alive[e] && e !== light) app.world.destroy(e);
  const maskStreamMaterial = app.materials.create({
      alphaMode: "MASK",
      alphaCutoff: 0.5,
    }),
    maskStreamWall = app.world.create(),
    maskStreamRear = app.world.create();
  app.world.transforms.add(maskStreamWall);
  app.world.transforms.setPosition(maskStreamWall, 0, 0, 1);
  app.world.meshes.set(maskStreamWall, depthQuad, maskStreamMaterial);
  app.world.bounds.setAABB(maskStreamWall, [-2, -2, 0], [2, 2, 0]);
  app.world.transforms.add(maskStreamRear);
  app.world.transforms.setScale(maskStreamRear, 0.1, 0.1, 0.1);
  app.world.meshes.set(maskStreamRear, 0, depthMaterial);
  app.world.bounds.setAABB(maskStreamRear, [-1, -1, -1], [1, 1, 1]);
  renderer.camera.setPosition(0, 0, 5);
  renderer.camera.setTarget(0, 0, 0);
  renderer.submissionMode = "gpu-indirect";
  renderer.gpuOcclusion.enabled = renderer.temporal.enabled = true;
  await streamCapture();
  await streamCapture();
  const beforeMaskStream = await streamCapture();
  const streamedMaskChecks = {
    beforeFlags: Array.from(await readVisibility(renderer.gpuFrustum)),
    beforeReuse: renderer.temporal.reuse,
  };
  streamContext.clearRect(0, 0, 8, 8);
  const transparentPng = new Uint8Array(
    await (
      await imageCanvas.convertToBlob({ type: "image/png" })
    ).arrayBuffer(),
  );
  const maskAsset = {
    ...textureAsset,
    textures: [
      {
        name: "transparent mask",
        mimeType: "image/png",
        image: transparentPng,
      },
    ],
  };
  await renderer.streaming.bindMaterial(
    maskStreamMaterial,
    "transparentMask",
    async () => maskAsset,
  );
  const revealedImage = await streamCapture();
  streamedMaskChecks.afterFlags = Array.from(
    await readVisibility(renderer.gpuFrustum),
  );
  streamedMaskChecks.materialReset = !renderer.temporal.reuse;
  streamedMaskChecks.sceneChanged = compareImages(
    beforeMaskStream,
    revealedImage,
  );
  renderer.submissionMode = "instanced";
  renderer.temporal.enabled =
    renderer.gpuOcclusion.enabled =
    renderer.gpuCompaction.enabled =
    renderer.gpuLOD.enabled =
    renderer.gpuFrustum.enabled =
    renderer.hiz.enabled =
    renderer.depthPrepass.enabled =
      false;
  streamedMaskChecks.image = compareImages(
    revealedImage,
    await streamCapture(),
  );
  renderer.streaming.releaseMaterial(maskStreamMaterial);
  await streamCapture();
  await streamCapture();
  await renderer.streaming.evictUnused(1);
  // Large diagnostic workload validates GPU choice for all CPU-frustum candidates.
  const lodWorld = new rw.constructor(100000, 1, 1, 1),
    lodFrustum = new renderer.gpuFrustum.constructor(
      gpu.device,
      renderer.resources,
      renderer.dynamic.buffers,
      100000,
    ),
    gpuSelector = new renderer.gpuLOD.constructor(
      gpu.device,
      renderer.resources,
      renderer.dynamic.buffers,
      lodFrustum,
      renderer.lodGroups,
    ),
    cpuSelector = new renderer.lodSelector.constructor(
      100000,
      renderer.lodGroups,
    ),
    lodCPUFrustum = new renderer.culler.constructor(100000);
  lodFrustum.enabled = gpuSelector.enabled = true;
  lodWorld.count = 100000;
  for (let i = 0; i < 100000; i++) {
    lodWorld.entityId[i] = i;
    lodWorld.meshId[i] = 0;
    lodWorld.lodGroup[i] = lodGroup;
    lodWorld.sphere.set(
      [
        ((i % 100) - 50) * 0.3,
        ((Math.floor(i / 100) % 100) - 50) * 0.3,
        -Math.floor(i / 10000) * 3,
        1,
      ],
      i * 4,
    );
  }
  lodFrustum.update(lodWorld, gpu.queue);
  gpuSelector.prepare(lodWorld, gpu.queue);
  const lodEnc = gpu.device.createCommandEncoder();
  lodFrustum.encode(lodEnc, renderer.dynamic.frameSlot);
  gpuSelector.encode(lodEnc, renderer.dynamic.frameSlot);
  gpu.queue.submit([lodEnc.finish()]);
  const lodResult = await readLOD(gpuSelector, 100000),
    lodCPUFlags = new Uint8Array(100000),
    lodVisible = lodCPUFrustum.cull(lodWorld, renderer.frustum, "sphere");
  for (let n = 0; n < lodVisible; n++)
    lodCPUFlags[lodCPUFrustum.visible[n]] = 1;
  cpuSelector.select(
    lodWorld,
    renderer.camera,
    gpu.canvas.height,
    lodCPUFrustum.visible,
    lodVisible,
  );
  let lodMismatches = 0;
  for (let i = 0; i < 100000; i++) {
    const expected = lodCPUFlags[i] ? lodWorld.lodSelection[i] : -3;
    if (
      lodResult.selections[i] !== expected ||
      (expected >= 0 && lodResult.meshes[i] !== lodWorld.meshId[i])
    )
      lodMismatches++;
  }
  const lodTimes = [],
    lodCPUTimes = [];
  for (let frame = 0; frame < 8; frame++) {
    const start = performance.now();
    cpuSelector.select(
      lodWorld,
      renderer.camera,
      gpu.canvas.height,
      lodCPUFrustum.visible,
      lodVisible,
    );
    if (frame >= 3) lodCPUTimes.push(performance.now() - start);
    const enc = gpu.device.createCommandEncoder(),
      t = performance.now();
    lodFrustum.encode(enc, renderer.dynamic.frameSlot);
    gpuSelector.encode(enc, renderer.dynamic.frameSlot);
    gpu.queue.submit([enc.finish()]);
    await gpu.queue.onSubmittedWorkDone();
    if (frame >= 3) lodTimes.push(performance.now() - t);
  }
  lodTimes.sort((a, b) => a - b);
  lodCPUTimes.sort((a, b) => a - b);
  gpuLODChecks.large = {
    count: 100000,
    frustumVisible: lodVisible,
    mismatches: lodMismatches,
    cpuLODMedianMs: lodCPUTimes[2],
    frustumAndLODCompletionMedianMs: lodTimes[2],
    distribution: lodResult.distribution,
  };
  lodFrustum.dispose();
  const validationError = await gpu.device.popErrorScope();
  const samples = Array.from(app.encodingTimes)
    .slice(20, Math.min(app.frames, 600))
    .sort((a, b) => a - b);
  const info = gpu.adapter.info;
  const report = {
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
    },
    format: gpu.format,
    frames: app.frames,
    frameCadence: {
      fps: renderer.stats.fps,
      frameTimeMs: renderer.stats.frameTimeMs,
      cpuFrameMs: renderer.stats.cpuFrameMs,
    },
    size: [app.canvas.width, app.canvas.height],
    pixel,
    centerPixel,
    materialChecks,
    assetPixel,
    pbrChecks,
    textureChecks,
    animationChecks,
    skinChecks,
    jointChecks,
    gpuSkinChecks,
    morphChecks,
    morphBufferChecks,
    gpuMorphChecks,
    combinedChecks,
    boundsChecks,
    blendingChecks,
    lodChecks,
    lightChecks,
    lightingBenchmark,
    clusterChecks,
    shadowChecks,
    profilingChecks,
    depthChecks,
    hizChecks,
    gpuVisibilityChecks,
    occlusionChecks,
    visibilityMatrix,
    compactionChecks,
    indirectChecks,
    gpuLODChecks,
    temporalChecks,
    streamingChecks,
    compressedChecks,
    streamedMaskChecks,
    graphOrder: renderer.graph.order.map((pass) => ({
      name: pass.name,
      reads: pass.reads,
      writes: pass.writes,
    })),
    errors: gpu.errors,
    validationError: validationError?.message ?? null,
    cpuEncodingMs: {
      median: samples[Math.floor(samples.length * 0.5)],
      p95: samples[Math.floor(samples.length * 0.95)],
    },
  };
  // This harness includes custom GPU-only fixtures. Test the opt-out loss UI here;
  // validate-device-recovery covers rehydration and automatic resume.
  app.autoRecoverDevice = false;
  // Destroy simulates loss and verifies the application's lost-device callback.
  gpu.device.destroy();
  await gpu.device.lost;
  await new Promise((resolve) => setTimeout(resolve, 0));
  report.lossHandled =
    gpu.lost && app.status.textContent.includes("GPU device lost");
  return report;
};
