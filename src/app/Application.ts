import { GPUContext } from "../gpu/GPUContext";
import { Renderer } from "../rendering/Renderer";
import { World } from "../ecs/World";
import { TransformSystem } from "../ecs/systems/TransformSystem";
import { RenderWorld } from "../rendering/RenderWorld";
import { RenderExtractor } from "../rendering/RenderExtractor";
import { MaterialManager } from "../rendering/materials/MaterialManager";

export class Application {
  gpu!: GPUContext;
  renderer!: Renderer;
  readonly world = new World();
  readonly transformSystem = new TransformSystem(this.world.capacity);
  readonly sceneEntity: number;
  readonly renderWorld = new RenderWorld(this.world.capacity);
  readonly extractor = new RenderExtractor();
  readonly materials = new MaterialManager();
  frames = 0;
  readonly encodingTimes = new Float64Array(600);
  private frameId = 0;
  private stopped = false;
  private observer?: ResizeObserver;
  private pixelRatio = window.devicePixelRatio;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly status: HTMLOutputElement,
  ) {
    this.sceneEntity = this.world.create();
    this.world.transforms.add(this.sceneEntity);
    this.world.meshes.set(this.sceneEntity, 0, 0);
    this.world.bounds.setSphere(this.sceneEntity, 0, 0, 0, Math.sqrt(3));
    this.materials.create();
  }

  async start(): Promise<void> {
    this.gpu = await GPUContext.create(
      this.canvas,
      (info) => {
        this.stop();
        this.status.textContent = `GPU device lost (${info.reason}): ${info.message}. Reload to restart.`;
      },
      (message) => {
        this.stop();
        this.status.textContent = `WebGPU error: ${message}`;
      },
    );
    this.transformSystem.update(this.world.transforms);
    this.extractor.extract(this.world, this.renderWorld);
    this.renderer = new Renderer(this.gpu, this.renderWorld, this.materials);
    this.observer = new ResizeObserver(() => this.gpu.resize());
    this.observer.observe(this.canvas);
    this.status.textContent = "WebGPU ready • indexed cube";
    this.frameId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (): void => {
    if (this.stopped || this.gpu.lost) return;
    if (this.pixelRatio !== window.devicePixelRatio) {
      this.pixelRatio = window.devicePixelRatio;
      this.gpu.resize();
    }
    const start = performance.now();
    this.transformSystem.update(this.world.transforms);
    this.extractor.extract(this.world, this.renderWorld);
    const encoder = this.gpu.device.createCommandEncoder({
      label: "Frame encoder",
    });
    this.renderer.encode(
      encoder,
      this.gpu.context.getCurrentTexture().createView(),
    );
    this.gpu.queue.submit([encoder.finish()]);
    this.encodingTimes[this.frames % this.encodingTimes.length] =
      performance.now() - start;
    this.frames++;
    this.frameId = requestAnimationFrame(this.frame);
  };

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frameId);
    this.observer?.disconnect();
  }

  async loadAsset(url: string): Promise<Uint32Array> {
    const [{ GLTFLoader }, { instantiate }] = await Promise.all([
      import("../assets/gltf/GLTFLoader"),
      import("../assets/gltf/instantiate"),
    ]);
    const asset = await new GLTFLoader().load(url);
    if (this.gpu.disposed || this.gpu.lost)
      throw new Error("Application stopped during asset loading");
    return instantiate(asset, this.world, this.renderer.meshes, this.materials);
  }

  dispose(): void {
    this.stop();
    this.renderer?.dispose();
    this.gpu?.dispose();
  }
}
