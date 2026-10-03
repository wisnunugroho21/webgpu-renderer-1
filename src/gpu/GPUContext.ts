export function canvasSize(
  width: number,
  height: number,
  pixelRatio: number,
  limit: number,
): [number, number] {
  const w = Math.max(1, Math.round(width * pixelRatio));
  const h = Math.max(1, Math.round(height * pixelRatio));
  const scale = Math.min(1, limit / Math.max(w, h));
  return [
    Math.max(1, Math.floor(w * scale)),
    Math.max(1, Math.floor(h * scale)),
  ];
}

/** Owns the device and presentation surface. No synchronous GPU waits per frame. */
export class GPUContext {
  readonly queue: GPUQueue;
  get renderFormat(): GPUTextureFormat {
    return `${this.format}-srgb` as GPUTextureFormat;
  }
  readonly errors: string[] = [];
  lost = false;
  disposed = false;

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
        this.errors.push(event.error.message);
        onError(event.error.message);
      },
    );
    void device.lost
      .then((info) => {
        this.lost = true;
        if (!this.disposed) onLost(info);
      })
      .catch((error) => onError(String(error)));
  }

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

  resize(): boolean {
    if (this.lost || this.disposed) return false;
    const [width, height] = canvasSize(
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      window.devicePixelRatio || 1,
      this.device.limits.maxTextureDimension2D,
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.context.unconfigure();
    this.device.destroy();
  }
}
