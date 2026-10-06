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
    // Delegates this operation to createBuffer.

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
      (v, i) =>
        /** Evaluates the Math.abs(v - renderer.camera.viewProjection[i]) > 0.001 condition. */ Math.abs(
          v - renderer.camera.viewProjection[i],
        ) > 0.001,
    ),
  };
};

/** Builds a record containing count, uncached ms, cached ms, stats. */
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

/** Builds a record containing count, individual ms, shared ms, shared buffer creations, arena buffers, upload bytes. */
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

/** Builds a record containing loading state, history, elapsed ms, cached ms, timings, frames during load. */
export const measureLoadingChecks = async () => {
  const app = window.rendererApp,
    url = "/regression/triangle.glb?async-check";
  const firstEntity = app.world.nextEntity,
    before = app.frames,
    start = performance.now();
  let eventLoopTurns = 0;
  const timer = setInterval(() => {
    // Measure UI task progress independently of software GPU presentation speed.
    eventLoopTurns++;
  }, 1);
  const first = app.loadAsset(url),
    second = app.loadAsset(url);
  const loadingState = app.assetLoader.get(url).state;
  try {
    await Promise.all([first, second]);
  } finally {
    clearInterval(timer);
  }
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
    eventLoopTurns,
    loaded,
    cached,
  };
};

/** Builds a record containing upload, prepared, main decode ms, cold worker ms, warm worker median ms, frames during worker. */
export const measureWorkerChecks = async () => {
  const app = window.rendererApp,
    url = new URL("/worker-large.glb", location.href).href;
  const probe = () => {
    // Macrotask progress measures responsiveness independently of GPU-bound presentation cadence.
    let turns = 0;
    const timer = setInterval(() => {
      // Count actual main-thread task turns while decode/upload is pending.
      turns++;
    }, 1);
    return () => {
      // Stop the probe before later tasks can inflate the measured operation's responsiveness.
      clearInterval(timer);
      return turns;
    };
  };
  const mainJSON = await app.gltf.fetch(url),
    start = performance.now(),
    beforeMain = app.frames;
  const mainProbe = probe();
  const reference = await app.gltf.parseJSON(mainJSON),
    mainDecodeMs = performance.now() - start;
  const framesDuringMain = app.frames - beforeMain,
    mainEventLoopTurns = mainProbe();
  const workerJSON = await app.gltf.fetch(url),
    inputBuffers = Object.values(workerJSON.resources).map(
      (data) => /** Returns data buffer. */ data.buffer,
    ),
    beforeWorker = app.frames;
  const workerProbe = probe();
  let t = performance.now();
  const asset = await app.assetDecoder.decode(workerJSON),
    coldWorkerMs = performance.now() - t;
  const framesDuringWorker = app.frames - beforeWorker,
    workerEventLoopTurns = workerProbe();
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
  samples.sort((a, b) => /** Computes the a - b result. */ a - b);
  const metrics = { ...app.assetDecoder.metrics },
    beforeBuffers = app.renderer.resources.stats.buffers;
  const sizes = [],
    original = app.gpu.queue.writeBuffer.bind(app.gpu.queue);
  app.gpu.queue.writeBuffer = (buffer, ...args) => {
    // Delegates this operation to original.

    if (buffer.label === "Asset vertices" || buffer.label === "Asset indices")
      sizes.push(args[1].byteLength);
    return original(buffer, ...args);
  };
  const uploadStart = performance.now(),
    beforeUploadFrames = app.frames;
  let instance;
  const uploadProbe = probe();
  let uploadEventLoopTurns;
  try {
    instance = await app.instantiateAsset(url);
  } finally {
    app.gpu.queue.writeBuffer = original;
    uploadEventLoopTurns = uploadProbe();
  }
  const upload = {
    totalMs: performance.now() - uploadStart,
    framesDuring: app.frames - beforeUploadFrames,
    eventLoopTurns: uploadEventLoopTurns,
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
    mainEventLoopTurns,
    workerEventLoopTurns,
    mismatches,
    inputDetached: inputBuffers.every(
      (b) =>
        /** Evaluates the b.byteLength === 0 condition. */ b.byteLength === 0,
    ),
    vertices: asset.meshes[0].primitives[0].attributes.POSITION.length / 3,
    metrics,
  };
};

/** Builds a record containing objects, results, resource before, resource after. */
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
    times.sort((a, b) => /** Computes the a - b result. */ a - b);
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
