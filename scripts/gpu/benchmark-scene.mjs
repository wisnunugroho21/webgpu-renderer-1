/** Runs inside Chrome via page.evaluate. Keep all helpers inside this callback:
 * Playwright serializes its source, so it cannot close over Node module imports.
 * The integrated scene deliberately retains asset/state transitions between checks. */
export const runBenchmarkMatrix = async (options = {}) => {
  const original = window.rendererApp,
    Application = original.constructor;
  original.stop();
  const results = {
    materials: [],
    animation: [],
    morph: [],
    combined: null,
    occlusion: [],
  };
  /** Returns the middle sorted timing sample to summarize diagnostic measurements. */
  const median = (values) =>
    values.slice().sort((a, b) => /** Computes the a - b result. */ a - b)[
      Math.floor(values.length / 2)
    ];
  /** Creates an isolated browser application, runs a diagnostic workload and releases it before reporting validation errors. */
  const withApp = async (capacity, run) => {
    const canvas = document.createElement("canvas"),
      status = document.createElement("output");
    canvas.style.width = "640px";
    canvas.style.height = "480px";
    document.body.append(canvas);
    const app = new Application(canvas, status, capacity, 16384);
    await app.start();
    app.stop();
    app.world.destroy(app.sceneEntity);
    app.renderer.cullingEnabled = false;
    app.renderer.camera.setPosition(0, 0, 60);
    app.renderer.camera.setTarget(0, 0, 0);
    app.gpu.device.pushErrorScope("validation");
    let result, validationError, gpuErrors;
    try {
      result = await run(app);
    } finally {
      try {
        validationError = await app.gpu.device.popErrorScope();
        gpuErrors = app.gpu.errors.slice();
      } finally {
        await app.dispose();
        canvas.remove();
      }
    }
    if (validationError) throw new Error(validationError.message);
    if (gpuErrors.length) throw new Error(gpuErrors.join("\n"));
    return result;
  };
  /** Warms the workload and records CPU/completion/GPU timings outside the ordinary rendering path. */
  const measure = async (
    app,
    before = () => {
      // Intentionally performs no work at this optional callback boundary.
    },
    long = false,
  ) => {
    const r = app.renderer,
      gpu = app.gpu,
      rows = [];
    const resources = { ...r.resources.stats };
    const frameCount = long ? 120 : 10,
      warmup = long ? 60 : 5;
    for (let frame = 0; frame < frameCount; frame++) {
      const row = {},
        start = performance.now();
      let t = start;
      before(frame);
      app.animations.update(1 / 60);
      row.animation = performance.now() - t;
      t = performance.now();
      app.transformSystem.update(app.world.transforms);
      row.transforms = performance.now() - t;
      t = performance.now();
      app.skeletonSystem.update(app.world, app.skeletons);
      row.skeletons = performance.now() - t;
      t = performance.now();
      app.animatedBounds.update(
        app.world,
        r.meshes,
        app.skeletons,
        app.animations.morphPool,
      );
      row.bounds = performance.now() - t;
      t = performance.now();
      app.extractor.extract(
        app.world,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
      row.extraction = performance.now() - t;
      r.stats.activeAnimators = app.animations.activeAnimators;
      r.gpuProfiler.enabled = frame >= frameCount - 3;
      const encoder = gpu.device.createCommandEncoder();
      t = performance.now();
      r.encode(
        encoder,
        gpu.context
          .getCurrentTexture()
          .createView({ format: gpu.renderFormat }),
      );
      row.encoding = performance.now() - t;
      gpu.queue.submit([encoder.finish()]);
      row.cpuFrame = performance.now() - start;
      await gpu.queue.onSubmittedWorkDone();
      row.completion = performance.now() - start;
      if (frame >= warmup) rows.push(row);
    }
    r.gpuProfiler.enabled = false;
    const intervals = await r.gpuProfiler.readSamples(),
      passes = {};
    for (const interval of intervals)
      (passes[interval.pass] ??= []).push(interval.milliseconds);
    const cpu = {};
    for (const key of Object.keys(rows[0]))
      cpu[key] = median(rows.map((row) => /** Returns row[key]. */ row[key]));
    const after = { ...r.resources.stats };
    // Initial dynamic/shadow state is warm after setup; resource creation is cold only.
    return {
      cpuMedianMs: cpu,
      gpuPassMedianMs: Object.fromEntries(
        Object.entries(passes).map(
          ([
            key,
            values,
          ]) => /** Returns the ordered values needed by this operation. */ [
            key,
            median(values),
          ],
        ),
      ),
      stats: { ...r.stats },
      resourcesBefore: resources,
      resourcesAfter: after,
      size: [canvasWidth(app), app.canvas.height],
    };
  };
  /** Renders and maps a complete diagnostic image for exact reference comparison. */
  const captureImage = async (app) => {
    const gpu = app.gpu,
      texture = gpu.context.getCurrentTexture(),
      row = Math.ceil((texture.width * 4) / 256) * 256,
      rb = gpu.device.createBuffer({
        size: row * texture.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      encoder = gpu.device.createCommandEncoder();
    app.renderer.encode(
      encoder,
      texture.createView({ format: gpu.renderFormat }),
    );
    encoder.copyTextureToBuffer({ texture }, { buffer: rb, bytesPerRow: row }, [
      texture.width,
      texture.height,
    ]);
    gpu.queue.submit([encoder.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(rb.getMappedRange()).slice();
    rb.unmap();
    rb.destroy();
    return bytes;
  };
  /** Returns count. */
  const visibleCount = async (app) => {
    const gpu = app.gpu,
      rb = gpu.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      encoder = gpu.device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      app.renderer.gpuCompaction.counter,
      0,
      rb,
      0,
      16,
    );
    gpu.queue.submit([encoder.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const count = new Uint32Array(rb.getMappedRange())[0];
    rb.unmap();
    rb.destroy();
    return count;
  };
  /** Returns app canvas width. */
  const canvasWidth = (app) => app.canvas.width;
  await withApp(16384, async (app) => {
    // Applies app.world.create, app.world.transforms.add, app.world.transforms.setPosition to the current callback state.

    const entities = [];
    for (let i = 0; i < 1000; i++) {
      const e = app.world.create();
      app.world.transforms.add(e);
      app.world.transforms.setPosition(
        e,
        ((i % 32) - 16) * 1.2,
        (Math.floor(i / 32) - 16) * 1.2,
        0,
      );
      app.world.transforms.setScale(e, 0.4, 0.4, 0.4);
      app.world.meshes.set(e, 0, 0);
      app.world.bounds.setAABB(e, [-1, -1, -1], [1, 1, 1]);
      entities.push(e);
    }
    const ids = Array.from({ length: 1000 }, (_, i) =>
      /** Delegates this operation to app.materials.create. */ app.materials.create(
        {
          baseColor: [
            ((i % 7) + 1) / 8,
            ((i % 11) + 1) / 12,
            ((i % 13) + 1) / 14,
            1,
          ],
        },
      ),
    );
    for (const count of [1, 100, 1000])
      for (const mode of ["individual", "sorted", "instanced"]) {
        app.renderer.submissionMode = mode;
        for (let i = 0; i < entities.length; i++)
          app.world.meshes.materialId[entities[i]] = ids[i % count];
        results.materials.push({
          materials: count,
          mode,
          ...(await measure(app)),
        });
      }
  });
  for (const count of [1, 100, 500, 1000])
    await withApp(100000, async (app) => {
      // Applies app.loadAsset, app.world.transforms.setPosition, Math.floor to the current callback state.

      for (let i = 0; i < count; i++) {
        const entities = await app.loadAsset(
          options.longAnimation
            ? "/regression/crowd-skin-long.glb"
            : "/regression/crowd-skin.glb",
        );
        app.world.transforms.setPosition(
          entities[0],
          ((i % 32) - 16) * 1.2,
          (Math.floor(i / 32) - 16) * 1.2,
          0,
        );
        const animator = app.animations.animators[i];
        animator.play(0);
        animator.currentTime = options.longAnimation
          ? (i * 30) / count
          : (i % 10) * 0.01;
      }
      const measured = await measure(app, undefined, options.longAnimation);
      measured.sharedSkeleton = app.skeletons.instances.every(
        (s) =>
          /** Evaluates the s.asset === app.skeletons.instances[0].asset condition. */ s.asset ===
          app.skeletons.instances[0].asset,
      );
      measured.sharedClip = app.animations.animators.every(
        (a) =>
          /** Evaluates the a.clips === app.animations.animators[0].clips condition. */ a.clips ===
          app.animations.animators[0].clips,
      );
      if (options.longAnimation) {
        // Diagnostic reference: re-sample the exact same times without hints,
        // then compare complete images. This cold readback is outside timings.
        const hinted = await captureImage(app);
        const samplers = new Set(
          app.animations.animators.flatMap((animator) =>
            /** Delegates this operation to animator.clips.flatMap. */ animator.clips.flatMap(
              (clip) =>
                /** Builds an output entry for each input item. */ clip.channels.map(
                  (c) => /** Returns c sampler. */ c.sampler,
                ),
            ),
          ),
        );
        for (const sampler of samplers) {
          const sample = sampler.sample;
          sampler.sample = function (time, out) {
            // Delegates this operation to sample.call.

            return sample.call(this, time, out);
          };
        }
        // Assigning the same time intentionally invokes the seek setter to re-sample.
        for (const animator of app.animations.animators) {
          const sampleTime = animator.currentTime;
          animator.currentTime = sampleTime;
        }
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
        const reference = await captureImage(app);
        let differentBytes = 0,
          maxDifference = 0;
        for (let i = 0; i < hinted.length; i++) {
          const delta = Math.abs(hinted[i] - reference[i]);
          differentBytes += delta !== 0 ? 1 : 0;
          maxDifference = Math.max(maxDifference, delta);
        }
        measured.sampleImageDifference = { differentBytes, maxDifference };
      }
      results.animation.push({
        characters: count,
        jointsPerCharacter: 64,
        warmupFrames: options.longAnimation ? 60 : 5,
        measuredFrames: options.longAnimation ? 60 : 5,
        keyCount:
          app.animations.animators[0].clips[0].channels[0].sampler.input.length,
        distinctPhases: new Set(
          app.animations.animators.map(
            (a) => /** Returns a current time. */ a.currentTime,
          ),
        ).size,
        verticesPerCharacter: 400,
        ...measured,
      });
    });
  /** Updates state weights[t], state dirty for update morph. */
  const updateMorph = (app, active, frame) => {
    for (const state of app.animations.morphStates) {
      for (let t = 0; t < state.targetCount; t++)
        state.weights[t] = t < active ? 0.1 + (frame + 1) * 0.001 : 0;
      state.dirty = true;
    }
  };
  await withApp(16384, async (app) => {
    // Applies app.loadAsset, app.world.transforms.setPosition, Math.floor to the current callback state.

    for (let i = 0; i < 1000; i++) {
      const entities = await app.loadAsset("/regression/crowd-morph.glb");
      app.world.transforms.setPosition(
        entities[0],
        ((i % 32) - 16) * 1.2,
        (Math.floor(i / 32) - 16) * 1.2,
        0,
      );
    }
    for (const active of [0, 1, 4, 8, 16])
      results.morph.push({
        characters: 1000,
        activeTargets: active,
        verticesPerCharacter: 400,
        ...(await measure(app, (frame) =>
          /** Delegates this operation to updateMorph. */ updateMorph(
            app,
            active,
            frame,
          ),
        )),
      });
  });
  await withApp(100000, async (app) => {
    // Applies app.loadAsset, app.world.transforms.setPosition, Math.floor to the current callback state.

    for (let i = 0; i < 1000; i++) {
      const entities = await app.loadAsset("/regression/crowd-combined.glb");
      app.world.transforms.setPosition(
        entities[0],
        ((i % 32) - 16) * 1.2,
        (Math.floor(i / 32) - 16) * 1.2,
        0,
      );
      app.animations.animators[i].play(0);
    }
    results.combined = {
      characters: 1000,
      jointsPerCharacter: 64,
      activeTargets: 16,
      verticesPerCharacter: 400,
      ...(await measure(app, (frame) =>
        /** Delegates this operation to updateMorph. */ updateMorph(
          app,
          16,
          frame,
        ),
      )),
    };
  });
  await withApp(16384, async (app) => {
    // Applies r.camera.setPosition, r.camera.setTarget, results.occlusion.push to the current callback state.

    const r = app.renderer;
    r.camera.setPosition(0, 0, 5);
    r.camera.setTarget(0, 0, 0);
    r.submissionMode = "gpu-indirect";
    if (!r.gpuDraws.supported) {
      results.occlusion.push({ unsupported: true });
      return;
    }
    const wallMesh = r.meshes.upload({
      attributes: {
        POSITION: new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]),
      },
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      mode: 4,
      material: 0,
      targets: [],
    });
    const wall = app.world.create();
    app.world.transforms.add(wall);
    app.world.transforms.setPosition(wall, 0, 0, 1);
    app.world.meshes.set(wall, wallMesh, 0);
    app.world.bounds.setAABB(wall, [-2, -2, 0], [2, 2, 0]);
    for (let i = 0; i < 10000; i++) {
      const e = app.world.create();
      app.world.transforms.add(e);
      app.world.transforms.setPosition(
        e,
        ((i % 100) - 50) * 0.01,
        (Math.floor(i / 100) - 50) * 0.01,
        -(i % 10) * 0.1,
      );
      app.world.transforms.setScale(e, 0.005, 0.005, 0.005);
      app.world.meshes.set(e, 0, 0);
      app.world.bounds.setAABB(e, [-1, -1, -1], [1, 1, 1]);
    }
    let frustumImage;
    for (const enabled of [false, true]) {
      r.gpuOcclusion.enabled = enabled;
      r.hiz.enabled = r.depthPrepass.enabled = enabled;
      const measured = await measure(app),
        image = await captureImage(app);
      measured.visibleInstances = await visibleCount(app);
      if (!enabled) frustumImage = image;
      else {
        let different = 0,
          maximum = 0;
        for (let i = 0; i < image.length; i++) {
          const delta = Math.abs(image[i] - frustumImage[i]);
          if (delta) different++;
          maximum = Math.max(maximum, delta);
        }
        measured.imageDifference = {
          differingBytes: different,
          maxDifference: maximum,
        };
      }
      results.occlusion.push({ occlusion: enabled, ...measured });
    }
  });

  await withApp(16384, async (app) => {
    // Applies indices.set, performance.now, r.meshes.upload to the current callback state.

    const r = app.renderer,
      g = r.geometryOptimization;
    results.geometry = {
      supported: g.supported,
      defaultEnabled: g.enabled,
      benchmarks: [],
      checks: [],
    };
    if (!g.supported) return;
    const nx = 1000,
      ny = 100,
      positions = new Float32Array((nx + 1) * (ny + 1) * 3),
      normals = new Float32Array(positions.length),
      indices = new Uint32Array(nx * ny * 6);
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= nx; x++) {
        const o = (y * (nx + 1) + x) * 3;
        positions[o] = (x - nx / 2) * 0.5;
        positions[o + 1] = (y - ny / 2) * 0.1;
        normals[o + 2] = 1;
      }
    let at = 0;
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const a = y * (nx + 1) + x,
          b = a + 1,
          c = a + nx + 1,
          d = c + 1;
        indices.set([a, b, c, c, b, d], at);
        at += 6;
      }
    const cold = performance.now(),
      meshID = r.meshes.upload({
        attributes: { POSITION: positions, NORMAL: normals },
        indices,
        mode: 4,
        material: -1,
        targets: [],
      });
    results.geometry.assetPreparationMs = performance.now() - cold;
    const mesh = r.meshes.get(meshID),
      material = app.materials.create({
        baseColor: [0.6, 0.4, 0.2, 1],
        doubleSided: true,
      }),
      e = app.world.create();
    app.world.transforms.add(e);
    app.world.meshes.set(e, meshID, material);
    app.world.bounds.setAABB(e, mesh.bounds.min, mesh.bounds.max);
    r.camera.setPosition(0, 0, 8);
    r.camera.setTarget(0, 0, 0);
    r.cullingEnabled = true;
    /** Applies app.transformSystem.update, app.skeletonSystem.update, app.animatedBounds.update to refresh. */
    const refresh = () => {
      app.transformSystem.update(app.world.transforms);
      app.skeletonSystem.update(app.world, app.skeletons);
      app.animatedBounds.update(
        app.world,
        r.meshes,
        app.skeletons,
        app.animations.morphPool,
      );
      app.extractor.extract(
        app.world,
        app.renderWorld,
        app.skeletons,
        app.animations.morphPool,
      );
    };
    /** Renders the requested configuration and captures its diagnostic reference pixels. */
    const image = async (enabled) => {
      g.enabled = enabled;
      refresh();
      return await captureImage(app);
    };
    /** Compares diagnostic pixel buffers and reports their differing values. */
    const difference = (a, b) => {
      let maxDifference = 0,
        differingBytes = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d) differingBytes++;
        maxDifference = Math.max(maxDifference, d);
      }
      return { maxDifference, differingBytes };
    };
    /** Reads GPU counters/arguments explicitly to verify conservative visibility and draw ranges. */
    const diagnostics = async () => {
      const n = g.count;
      if (!n)
        return {
          candidates: 0,
          visible: 0,
          rejected: 0,
          falseInvisible: 0,
          drawnTriangles: 0,
        };
      const rb = app.gpu.device.createBuffer({
          size: n * 20,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
        enc = app.gpu.device.createCommandEncoder();
      enc.copyBufferToBuffer(g.arguments, 0, rb, 0, n * 20);
      app.gpu.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const args = new Uint32Array(rb.getMappedRange()).slice();
      rb.unmap();
      rb.destroy();
      const data = g.data,
        bits = new Uint32Array(data.buffer),
        instances = r.instances.data,
        matrices = app.renderWorld.matrices,
        vp = r.camera.viewProjection;
      let visible = 0,
        falseInvisible = 0,
        drawnTriangles = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 12,
          first = bits[o + 11],
          m = instances[first * 12] * 16;
        const outside = [true, true, true, true, true, true];
        // Independent clip-space reference transforms all eight actual local-box corners.
        for (let corner = 0; corner < 8; corner++) {
          const x = data[o + (corner & 1 ? 4 : 0)],
            y = data[o + (corner & 2 ? 5 : 1)],
            z = data[o + (corner & 4 ? 6 : 2)],
            v = [0, 0, 0, 0],
            clip = [0, 0, 0, 0];
          for (let a = 0; a < 4; a++)
            v[a] =
              matrices[m + a] * x +
              matrices[m + 4 + a] * y +
              matrices[m + 8 + a] * z +
              matrices[m + 12 + a];
          for (let a = 0; a < 4; a++)
            for (let b = 0; b < 4; b++) clip[a] += vp[b * 4 + a] * v[b];
          const distances = [
            clip[3] + clip[0],
            clip[3] - clip[0],
            clip[3] + clip[1],
            clip[3] - clip[1],
            clip[2],
            clip[3] - clip[2],
          ];
          for (let p = 0; p < 6; p++) if (distances[p] >= 0) outside[p] = false;
        }
        if (args[i * 5 + 1]) {
          visible++;
          drawnTriangles += args[i * 5] / 3;
        } else if (!outside.some(Boolean)) falseInvisible++;
        if (
          args[i * 5] !== bits[o + 8] ||
          args[i * 5 + 2] !== bits[o + 9] ||
          args[i * 5 + 3] !== 0 ||
          args[i * 5 + 4] !== first
        )
          throw new Error("Invalid cluster draw range");
      }
      return {
        candidates: n,
        visible,
        rejected: n - visible,
        falseInvisible,
        drawnTriangles,
      };
    };
    for (const workload of ["mostly-outside", "fully-visible"]) {
      app.world.transforms.setScale(
        e,
        workload === "fully-visible" ? 0.01 : 1,
        workload === "fully-visible" ? 0.5 : 1,
        1,
      );
      const before = await image(false),
        after = await image(true),
        imageDifference = difference(before, after),
        diagnostic = await diagnostics();
      for (const enabled of [false, true]) {
        g.enabled = enabled;
        results.geometry.benchmarks.push({
          workload,
          enabled,
          triangles: indices.length / 3,
          clusters: mesh.clusters.count,
          imageDifference,
          diagnostic: enabled ? diagnostic : null,
          ...(await measure(app)),
        });
      }
    }
    /** Applies image, results.geometry.checks.push, difference to check. */
    const check = async (name) => {
      const before = await image(false),
        after = await image(true);
      results.geometry.checks.push({
        name,
        imageDifference: difference(before, after),
        diagnostic: await diagnostics(),
        stats: { ...r.stats },
      });
    };
    app.world.transforms.setScale(e, 1, 1, 1);
    r.depthPrepass.enabled = true;
    await check("depth-prepass");
    r.depthPrepass.enabled = false;
    const parent = app.world.create();
    app.world.transforms.add(parent);
    app.world.transforms.setScale(parent, -0.7, 1.2, 0.9);
    app.world.transforms.setParent(e, parent);
    app.world.transforms.setRotation(e, 0, 0, Math.sin(0.3), Math.cos(0.3));
    const second = app.world.create();
    app.world.transforms.add(second);
    app.world.transforms.setPosition(second, 2, 0, -0.2);
    app.world.meshes.set(second, meshID, material);
    app.world.bounds.setAABB(second, mesh.bounds.min, mesh.bounds.max);
    await check("mirrored-sheared-instancing");
    const mask = app.materials.create({
      baseColor: [0.2, 0.8, 0.3, 0.6],
      alphaMode: "MASK",
      alphaCutoff: 0.5,
      doubleSided: true,
    });
    app.world.meshes.materialId[e] = mask;
    app.world.meshes.materialId[second] = mask;
    await check("alpha-mask");
    app.world.lights.set(app.defaultLightEntity, {
      type: "directional",
      castShadow: true,
      direction: [0.3, -1, -0.2],
    });
    r.shadows.cascades = 1;
    r.shadows.cacheEnabled = false;
    await check("shadows");
    app.world.lights.set(app.defaultLightEntity, {
      type: "directional",
      direction: [0, 0, -1],
    });
    const coarse = r.meshes.upload({
      attributes: {
        POSITION: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        NORMAL: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      },
      indices: new Uint32Array([0, 1, 2]),
      mode: 4,
      material: -1,
      targets: [],
    });
    const lod = r.lodGroups.register(
      [meshID, coarse],
      [100000, 1],
      r.meshes,
      0,
    );
    app.world.transforms.setParent(e, -1);
    app.world.transforms.setRotation(e, 0, 0, 0, 1);
    app.world.transforms.setScale(e, 0.01, 0.01, 0.01);
    app.world.meshes.setLOD(e, lod);
    await check("cpu-lod");
    app.world.meshes.setLOD(e, -1);
    app.world.transforms.setScale(e, 1, 1, 1);
    r.camera.setPosition(0, 0, 0.2);
    await check("near-plane");
    r.camera.setPosition(0, 0, 8);
    r.cullingEnabled = false;
    await check("culling-disabled");
    r.cullingEnabled = true;
    app.canvas.style.width = "321px";
    app.canvas.style.height = "241px";
    app.gpu.resize();
    await check("odd-viewport-resize");
    const blend = app.materials.create({
      baseColor: [0.2, 0.8, 0.3, 0.5],
      alphaMode: "BLEND",
      doubleSided: true,
    });
    app.world.meshes.materialId[e] = blend;
    app.world.meshes.materialId[second] = blend;
    await check("transparent-fallback");
    app.world.meshes.materialId[e] = material;
    app.world.meshes.materialId[second] = material;
    r.submissionMode = "gpu-indirect";
    await check("gpu-object-indirect-fallback");
    r.submissionMode = "instanced";
    r.gpuFrustum.enabled = r.gpuCompaction.enabled = r.gpuLOD.enabled = false;
    app.world.destroy(parent);
    app.world.destroy(e);
    app.world.destroy(second);
    await app.loadAsset("/regression/crowd-combined.glb");
    app.animations.animators[0].play(0);
    app.animations.update(0.1);
    app.animations.morphStates[0].weights[0] = 0.2;
    app.animations.morphStates[0].dirty = true;
    await check("morph-skin-fallback");
    g.enabled = false;
  });
  return results;
};
