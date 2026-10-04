import { Resources } from "../../gpu/Resources";
import {
  EnvironmentCubeLevel,
  EnvironmentData,
  packHalf,
  validateEnvironment,
} from "./EnvironmentData";
interface InstalledEnvironment {
  data: EnvironmentData;
  textures: GPUTexture[];
  buffer: GPUBuffer;
  group: GPUBindGroup;
}
/** One environment per renderer; shared by every material and submission mode.
 * Replacement is transactional and retirement fences submitted work on this cold path.
 */
export class EnvironmentLighting {
  private installed?: InstalledEnvironment;
  private bindingLayout?: GPUBindGroupLayout;
  private sequence: Promise<void> = Promise.resolve();
  private disposed = false;
  private enabledValue = false;
  private readonly params = new Float32Array([1, 0, 1, 0]);
  private dirty = false;
  private angle = 0;
  /** Initializes one shared linear diffuse/specular environment and BRDF lookup. */
  constructor(
    private readonly device: GPUDevice,
    private readonly resources: Resources,
    private readonly preparePipelines: (layout: GPUBindGroupLayout) => void,
  ) {}
  /** Returns installed? data. */
  get data(): EnvironmentData | undefined {
    return this.installed?.data;
  }
  /** Evaluates the this.enabledValue && !!this.installed condition. */
  get active(): boolean {
    return this.enabledValue && !!this.installed;
  }
  /** Returns installed? group. */
  get group(): GPUBindGroup | undefined {
    return this.installed?.group;
  }
  /** Reports whether environment contributions are requested. */
  get enabled(): boolean {
    return this.enabledValue;
  }
  /** Toggles use of the installed environment without discarding its resident resources. */
  set enabled(value: boolean) {
    this.enabledValue = value;
  }
  /** Returns the radiance multiplier applied to environment lighting. */
  get intensity(): number {
    return this.params[0]!;
  }
  /** Validates the environment radiance multiplier and marks its uniform dirty. */
  set intensity(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 65504)
      throw new Error("Invalid environment intensity");
    if (this.params[0] !== value) {
      this.params[0] = value;
      this.dirty = true;
    }
  }
  /** Returns the environment rotation about the vertical axis in radians. */
  get rotationY(): number {
    return this.angle;
  }
  /** Validates world-Y environment rotation in radians and marks lookup parameters dirty. */
  set rotationY(value: number) {
    if (!Number.isFinite(value))
      throw new Error("Invalid environment rotation");
    this.angle = value;
    this.params[2] = Math.cos(value);
    this.params[3] = Math.sin(value);
    this.dirty = true;
  }
  /** Serializes transactional environment replacement and retires the previous GPU resources safely. */
  set(data: EnvironmentData | null): Promise<void> {
    const operation = this.sequence.then(() =>
      /** Continues environment lighting after the preceding asynchronous operation succeeds. */ this.install(
        data,
      ),
    );
    this.sequence = operation.catch(() => {
      // Intentionally performs no work at this optional callback boundary.
    });
    return operation;
  }
  /** Uploads changed environment intensity/rotation parameters only when active. */
  flush(skybox = false): void {
    if (this.dirty && this.installed && (this.active || skybox)) {
      this.device.queue.writeBuffer(this.installed!.buffer, 0, this.params);
      this.dirty = false;
    }
  }
  /** Computes the this.bindingLayout ??= this.device.createBindGroupLayout({ entries: [ { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform", minBindingSi result. */
  private get layout(): GPUBindGroupLayout {
    return (this.bindingLayout ??= this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: 16 },
        },
        ...[1, 2].map(
          (
            binding,
          ) => /** Builds a record containing binding, visibility, texture. */ ({
            binding,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {
              sampleType: "float" as const,
              viewDimension: "cube" as const,
            },
          }),
        ),
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    }));
  }
  /** Uploads validated diffuse/specular cubes and the BRDF lookup before publishing the environment group. */
  private async install(data: EnvironmentData | null): Promise<void> {
    if (this.disposed) throw new Error("Environment lighting is disposed");
    let prepared: InstalledEnvironment | undefined;
    if (data) {
      // Reject malformed data before creating GPU resources or disturbing the old environment.
      validateEnvironment(data, this.device.limits.maxTextureDimension2D);
      const textures: GPUTexture[] = [];
      let buffer: GPUBuffer | undefined;
      this.device.pushErrorScope("validation");
      let failure: unknown;
      try {
        /** Uploads one linear HDR cubemap mip chain with the correct face layout. */
        const cube = (levels: readonly EnvironmentCubeLevel[]) => {
          const texture = this.resources.textures.create({
            size: [levels[0]!.size, levels[0]!.size, 6],
            mipLevelCount: levels.length,
            format: "rgba16float",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          textures.push(texture);
          for (let mip = 0; mip < levels.length; mip++) {
            const level = levels[mip]!;
            for (let face = 0; face < 6; face++)
              this.device.queue.writeTexture(
                { texture, mipLevel: mip, origin: [0, 0, face] },
                packHalf(level.faces[face]!),
                { bytesPerRow: level.size * 8 },
                [level.size, level.size, 1],
              );
          }
          return texture.createView({ dimension: "cube" });
        };
        const diffuse = cube([data.diffuse]),
          specular = cube(data.specular);
        const lut = this.resources.textures.create({
          size: [data.brdf.size, data.brdf.size],
          format: "rgba16float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        textures.push(lut);
        this.device.queue.writeTexture(
          { texture: lut },
          packHalf(data.brdf.pixels),
          { bytesPerRow: data.brdf.size * 8 },
          [data.brdf.size, data.brdf.size],
        );
        buffer = this.resources.buffers.create({
          label: "Environment parameters",
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const params = this.params.slice();
        params[1] = data.specular.length - 1;
        this.device.queue.writeBuffer(buffer, 0, params);
        const sampler = this.resources.samplers.get({
          minFilter: "linear",
          magFilter: "linear",
          mipmapFilter: "linear",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge",
          addressModeW: "clamp-to-edge",
        });
        const layout = this.layout;
        const group = this.device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer } },
            { binding: 1, resource: diffuse },
            { binding: 2, resource: specular },
            { binding: 3, resource: lut.createView() },
            { binding: 4, resource: sampler },
          ],
        });
        this.preparePipelines(layout);
        prepared = { data, textures, buffer, group };
      } catch (error) {
        failure = error;
      }
      try {
        const error = await this.device.popErrorScope();
        if (error) failure ??= new Error(error.message);
      } catch (error) {
        failure ??= error;
      }
      if (failure || this.disposed) {
        for (const texture of textures)
          this.resources.textures.destroy(texture);
        if (buffer) this.resources.buffers.destroy(buffer);
        throw (
          failure ??
          new Error("Environment lighting disposed during installation")
        );
      }
      this.params[1] = data.specular.length - 1;
      this.dirty = true;
    }
    const previous = this.installed;
    this.installed = prepared;
    this.enabledValue = !!prepared;
    // New frames select the new environment before old GPU resources are retired.
    if (previous) {
      try {
        await this.device.queue.onSubmittedWorkDone();
      } catch {
        /* Device loss still retires ownership. */
      }
      this.release(previous);
    }
  }
  /** Destroys retired environment textures and parameter storage after their queued uses are safe. */
  private release(environment: InstalledEnvironment): void {
    for (const texture of environment.textures)
      this.resources.textures.destroy(texture);
    this.resources.buffers.destroy(environment.buffer);
  }
  /** Releases the installed environment and prevents further replacement publication. */
  dispose(): void {
    this.disposed = true;
    if (this.installed) this.release(this.installed);
    this.installed = undefined;
  }
}
