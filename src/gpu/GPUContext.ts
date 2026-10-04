/** Computes physical render dimensions from CSS size, pixel ratio and render scale, clamped to the device texture limit. */
export function canvasSize(
  width: number,
  height: number,
  pixelRatio: number,
  limit: number,
  renderScale = 1,
): [number, number] {
  if (!Number.isFinite(renderScale) || renderScale < 0.25 || renderScale > 2)
    throw new RangeError("Render scale must be between 0.25 and 2");
  const w = Math.max(1, Math.round(width * pixelRatio * renderScale));
  const h = Math.max(1, Math.round(height * pixelRatio * renderScale));
  const scale = Math.min(1, limit / Math.max(w, h));
  return [
    Math.max(1, Math.floor(w * scale)),
    Math.max(1, Math.floor(h * scale)),
  ];
}

/** Owns the device and presentation surface. No synchronous GPU waits per frame. */
export class GPUContext {
  readonly queue: GPUQueue;
  private scale = 1;
  /** Returns the resolution multiplier applied to physical canvas dimensions. */
  get renderScale(): number {
    return this.scale;
  }
  /** Cold quality change: resize presentation and dependent targets on the next frame. */
  set renderScale(value: number) {
    if (!Number.isFinite(value) || value < 0.25 || value > 2)
      throw new RangeError("Render scale must be between 0.25 and 2");
    if (this.disposed || this.lost) throw new Error("GPU device unavailable");
    if (value === this.scale) return;
    this.scale = value;
    this.resize();
  }
  /** Returns the sRGB attachment-view format used for one final linear-to-display encoding. */
  get renderFormat(): GPUTextureFormat {
    return `${this.format}-srgb` as GPUTextureFormat;
  }
  readonly errors: string[] = [];
  lost = false;
  disposed = false;

  /** Initializes the WebGPU device, queue and presentation surface. */
  private constructor(
    readonly adapter: GPUAdapter,
    readonly device: GPUDevice,
    readonly context: GPUCanvasContext,
    readonly format: GPUTextureFormat,
    readonly canvas: HTMLCanvasElement,
    onLost: (info: GPUDeviceLostInfo) => void,
    onError: (message: string) => void,
  ) {
    this.queue = device.queue;
    device.addEventListener(
      "uncapturederror",
      (event: GPUUncapturedErrorEvent) => {
        // Handles the uncapturederror event for gpucontext.

        this.errors.push(event.error.message);
        onError(event.error.message);
      },
    );
    void device.lost
      .then((info) => {
        // Marks the context lost and forwards the loss notification unless it was already disposed.

        this.lost = true;
        if (!this.disposed) onLost(info);
      })
      .catch((error) =>
        /** Handles asynchronous failure so gpucontext can report or retire the failed operation. */ onError(
          String(error),
        ),
      );
  }

  /** Requests supported optional adapter features, creates the device and configures the sRGB canvas view. */
  static async create(
    canvas: HTMLCanvasElement,
    onLost: (info: GPUDeviceLostInfo) => void,
    onError: (message: string) => void,
  ): Promise<GPUContext> {
    if (!navigator.gpu)
      throw new Error(
        "WebGPU is unavailable. Open this page in a WebGPU browser on localhost or HTTPS.",
      );
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("No WebGPU adapter is available.");
    const requiredFeatures: GPUFeatureName[] = [];
    for (const feature of [
      "timestamp-query",
      "indirect-first-instance",
      "texture-compression-bc",
      "texture-compression-etc2",
      "texture-compression-astc",
    ] as const)
      if (adapter.features.has(feature)) requiredFeatures.push(feature);
    const device = await adapter.requestDevice({ requiredFeatures });
    const context = canvas.getContext("webgpu");
    if (!context) {
      device.destroy();
      throw new Error("Cannot create a WebGPU canvas context.");
    }
    const gpu = new GPUContext(
      adapter,
      device,
      context,
      navigator.gpu.getPreferredCanvasFormat(),
      canvas,
      onLost,
      onError,
    );
    gpu.resize();
    return gpu;
  }

  /** Updates physical canvas dimensions from CSS size, device pixel ratio and render scale within device limits. */
  resize(): boolean {
    if (this.lost || this.disposed) return false;
    const [width, height] = canvasSize(
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      window.devicePixelRatio || 1,
      this.device.limits.maxTextureDimension2D,
      this.scale,
    );
    const changed =
      this.canvas.width !== width || this.canvas.height !== height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
      viewFormats: [this.renderFormat],
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    return changed;
  }

  /** Unconfigures presentation and destroys the owned device without resuming rendering. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.context.unconfigure();
    this.device.destroy();
  }
}
