/** Closure-free browser diagnostics. GPU waits/readbacks are intentional here only. */
export const measureCameraCheck = () => {
  const app = window.rendererApp,
    renderer = app.renderer;
  // Complete the expected resize allocation before checking steady state.
  renderer.resize();
  const originalBuffer = renderer.frameBuffer;
  const statsBefore = { ...renderer.resources.stats };
  const createBuffer = app.gpu.device.createBuffer.bind(app.gpu.device);
  let creations = 0;
  app.gpu.device.createBuffer = (...args) => {
    creations++;
    return createBuffer(...args);
  };
  for (let i = 0; i < 100; i++) {
    renderer.camera.setPosition(3 + i * 0.01, 2, 5);
    const encoder = app.gpu.device.createCommandEncoder();
    renderer.encode(
      encoder,
      app.gpu.context
        .getCurrentTexture()
        .createView({ format: app.gpu.renderFormat }),
    );
    app.gpu.queue.submit([encoder.finish()]);
  }
  const movedMatrix = Array.from(renderer.camera.viewProjection);
  renderer.camera.setPosition(3, 2, 5);
  renderer.camera.update(4 / 3);
  // Mark dirty again so the restored camera is uploaded for the next frame.
  renderer.camera.setPosition(3, 2, 5);
  app.gpu.device.createBuffer = createBuffer;
  const statsAfter = { ...renderer.resources.stats };
  return {
    creations,
    statsBefore,
    statsAfter,
    sameBuffer: renderer.frameBuffer === originalBuffer,
    moved: movedMatrix.some(
      (v, i) => Math.abs(v - renderer.camera.viewProjection[i]) > 0.001,
    ),
  };
};

export const measureResourceBenchmark = () => {
  const r = window.rendererApp.renderer,
    d = r.pipelineDescriptor,
    count = 100;
  let start = performance.now();
  for (let i = 0; i < count; i++) r.gpu.device.createRenderPipeline(d);
  const uncachedMs = performance.now() - start;
  start = performance.now();
  for (let i = 0; i < count; i++)
    if (r.resources.pipelines.get(d) !== r.pipeline)
      throw new Error("Cache identity mismatch");
  return {
    count,
    uncachedMs,
    cachedMs: performance.now() - start,
    stats: { ...r.resources.stats },
  };
};

export const measureDynamicBenchmark = () => {
  const r = window.rendererApp.renderer,
    count = 10000,
    data = new Float32Array(16);
  let start = performance.now();
  for (let i = 0; i < count; i++) {
    const buffer = r.gpu.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    r.gpu.queue.writeBuffer(buffer, 0, data);
    buffer.destroy();
  }
  const individualMs = performance.now() - start,
    before = r.resources.stats.bufferCreations;
  start = performance.now();
  r.dynamic.beginFrame(0);
  for (let i = 0; i < count; i++)
    r.dynamic.write(r.dynamic.allocate(64, 16), data);
  r.dynamic.flush(r.gpu.queue);
  return {
    count,
    individualMs,
    sharedMs: performance.now() - start,
    sharedBufferCreations: r.resources.stats.bufferCreations - before,
    arenaBuffers: r.dynamic.buffers.length,
    uploadBytes: r.dynamic.uploadBytes,
  };
};

export const measureLoadingChecks = async () => {
  const app = window.rendererApp,
    url = "/regression/triangle.glb?async-check";
  const firstEntity = app.world.nextEntity,
    before = app.frames,
    start = performance.now();
  const first = app.loadAsset(url),
    second = app.loadAsset(url);
  const loadingState = app.assetLoader.get(url).state;
  await Promise.all([first, second]);
  const elapsedMs = performance.now() - start,
    record = app.assetLoader.get(url);
  const loaded = { ...app.renderer.resources.stats },
    cachedStart = performance.now();
  await app.loadAsset(url);
  const cachedMs = performance.now() - cachedStart,
    cached = { ...app.renderer.resources.stats };
  for (let e = firstEntity; e < app.world.nextEntity; e++) app.world.destroy(e);
  app.transformSystem.update(app.world.transforms);
  app.extractor.extract(
    app.world,
    app.renderWorld,
    app.skeletons,
    app.animations.morphPool,
  );
  return {
    loadingState,
    history: record.history,
    elapsedMs,
    cachedMs,
    timings: record.timings,
    framesDuringLoad: app.frames - before,
    loaded,
    cached,
  };
};

export const measureWorkerChecks = async () => {
  const app = window.rendererApp,
    url = new URL("/worker-large.glb", location.href).href;
  const mainJSON = await app.gltf.fetch(url),
    start = performance.now(),
    beforeMain = app.frames;
  const reference = await app.gltf.parseJSON(mainJSON),
    mainDecodeMs = performance.now() - start;
  const framesDuringMain = app.frames - beforeMain;
  const workerJSON = await app.gltf.fetch(url),
    inputBuffers = Object.values(workerJSON.resources).map(
      (data) => data.buffer,
    ),
    beforeWorker = app.frames;
  let t = performance.now();
  const asset = await app.assetDecoder.decode(workerJSON),
    coldWorkerMs = performance.now() - t;
  const framesDuringWorker = app.frames - beforeWorker;
  let mismatches = 0;
  for (const key of Object.keys(reference.meshes[0].primitives[0].attributes)) {
    const a = reference.meshes[0].primitives[0].attributes[key],
      b = asset.meshes[0].primitives[0].attributes[key];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) mismatches++;
  }
  const samples = [];
  for (let f = 0; f < 3; f++) {
    const json = await app.gltf.fetch(url);
    t = performance.now();
    await app.assetDecoder.decode(json);
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const metrics = { ...app.assetDecoder.metrics },
    beforeBuffers = app.renderer.resources.stats.buffers;
  const sizes = [],
    original = app.gpu.queue.writeBuffer.bind(app.gpu.queue);
  app.gpu.queue.writeBuffer = (buffer, ...args) => {
    if (buffer.label === "Asset vertices" || buffer.label === "Asset indices")
      sizes.push(args[1].byteLength);
    return original(buffer, ...args);
  };
  const uploadStart = performance.now(),
    beforeUploadFrames = app.frames;
  let instance;
  try {
    instance = await app.instantiateAsset(url);
  } finally {
    app.gpu.queue.writeBuffer = original;
  }
  const upload = {
    totalMs: performance.now() - uploadStart,
    framesDuring: app.frames - beforeUploadFrames,
    chunks: sizes.length,
    maxChunk: Math.max(...sizes),
  };
  await instance.dispose();
  await app.unloadAsset(url);
  upload.buffersRestored =
    app.renderer.resources.stats.buffers === beforeBuffers;
  return {
    upload,
    prepared: Boolean(asset.meshes[0].primitives[0].prepared),
    mainDecodeMs,
    coldWorkerMs,
    warmWorkerMedianMs: samples[1],
    framesDuringWorker,
    framesDuringMain,
    mismatches,
    inputDetached: inputBuffers.every((b) => b.byteLength === 0),
    vertices: asset.meshes[0].primitives[0].attributes.POSITION.length / 3,
    metrics,
  };
};

export const measureDrawBenchmark = async () => {
  const app = window.rendererApp,
    r = app.renderer,
    w = app.world;
  app.stop();
  for (let i = 0; i < 10000; i++) {
    const e = i === 0 ? app.sceneEntity : w.create();
    w.transforms.add(e);
    w.meshes.set(e, 0, 0, 1 << 16);
    w.bounds.setSphere(e, 0, 0, 0, Math.sqrt(3));
    w.transforms.setPosition(
      e,
      ((i % 100) - 49.5) * 0.09,
      (Math.floor(i / 100) - 49.5) * 0.09,
      0,
    );
    w.transforms.setScale(e, 0.03, 0.03, 0.03);
  }
  app.transformSystem.update(w.transforms);
  app.animatedBounds.update(
    app.world,
    app.renderer.meshes,
    app.skeletons,
    app.animations.morphPool,
  );
  app.extractor.extract(w, app.renderWorld);
  r.camera.setPosition(0, 0, 15);
  const resourceBefore = { ...r.resources.stats },
    results = {};
  for (const mode of ["individual", "sorted", "instanced", "instanced-bvh"]) {
    r.submissionMode = mode === "instanced-bvh" ? "instanced" : mode;
    r.visibilityMode = mode === "instanced-bvh" ? "bvh" : "linear";
    const times = [];
    let texture, buffer;
    for (let frame = 0; frame < 7; frame++) {
      texture = r.gpu.context.getCurrentTexture();
      const encoder = r.gpu.device.createCommandEncoder(),
        start = performance.now();
      r.encode(encoder, texture.createView({ format: r.gpu.renderFormat }));
      if (frame === 6) {
        const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
        buffer = r.gpu.device.createBuffer({
          size: bytesPerRow * texture.height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
          texture.width,
          texture.height,
        ]);
      }
      r.gpu.queue.submit([encoder.finish()]);
      if (frame >= 2) times.push(performance.now() - start);
      // Benchmark-only synchronization keeps this stress test bounded.
      await r.gpu.queue.onSubmittedWorkDone();
    }
    const stats = { ...r.stats };
    await buffer.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(buffer.getMappedRange());
    let hash = 2166136261;
    for (const value of bytes) hash = Math.imul(hash ^ value, 16777619) >>> 0;
    buffer.unmap();
    buffer.destroy();
    times.sort((a, b) => a - b);
    results[mode] = {
      medianCpuMs: times[2],
      samples: times,
      stats,
      imageHash: hash,
    };
  }
  return {
    objects: 10000,
    results,
    resourceBefore,
    resourceAfter: { ...r.resources.stats },
  };
};
