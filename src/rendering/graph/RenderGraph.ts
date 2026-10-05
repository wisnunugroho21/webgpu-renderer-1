import {
  planTargets,
  RenderGraphTargets,
  type ResourceLifetime,
  type TargetPlan,
  type TransientTexture,
} from "./ResourceLifetimes";
import {
  targetDescriptor,
  type TransientTargetPool,
} from "../../gpu/TransientTargetPool";
export interface RenderGraphPass<Context> {
  readonly name: string;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly dependsOn?: readonly string[];
  readonly execute: (encoder: GPUCommandEncoder, context: Context) => void;
}
/** Cold dependency validation/compilation; execute traverses a persistent schedule. */
export class RenderGraph<Context = void> {
  private readonly passes: RenderGraphPass<Context>[] = [];
  private readonly imported: Set<string>;
  private compiled = false;
  private readonly textures = new Map<string, TransientTexture>();
  private readonly resourceLifetimes = new Map<string, ResourceLifetime>();
  private targetPlan?: TargetPlan;
  /** Compiled first/last use for imported inputs and every explicit output version. */
  get lifetimes(): ReadonlyMap<string, ResourceLifetime> {
    return this.resourceLifetimes;
  }
  /** Descriptor compatibility and physical assignments are computed once at compilation. */
  get targets(): TargetPlan {
    if (!this.targetPlan)
      throw new Error("Compile render graph before target planning");
    return this.targetPlan;
  }
  /** Declare disposable texture storage before compilation; its producer must initialize all contents. */
  transient(name: string, definition: TransientTexture): void {
    if (this.compiled) throw new Error("Cannot mutate compiled render graph");
    if (this.textures.has(name) || this.imported.has(name))
      throw new Error("Duplicate/imported transient resource");
    if (
      definition.initialization !== "clear" &&
      definition.initialization !== "full-write"
    )
      throw new Error("Transient first write must initialize contents");
    this.textures.set(name, {
      ...definition,
      descriptor: targetDescriptor(definition.descriptor).descriptor,
    });
  }
  /** Cold preparation returns leases/views that callers retain across frame executions. */
  prepareTargets(pool: TransientTargetPool): RenderGraphTargets {
    return new RenderGraphTargets(pool, this.targets);
  }

  private readonly schedule: RenderGraphPass<Context>[] = [];
  private publishedOrder: readonly RenderGraphPass<Context>[] = Object.freeze(
    [],
  );
  /** Inspect the stable schedule without mutating lifetime indices after compilation. */
  get order(): readonly RenderGraphPass<Context>[] {
    return this.publishedOrder;
  }
  /** Initializes validated pass dependencies and a persistent execution schedule. */
  constructor(importedResources: readonly string[] = []) {
    this.imported = new Set(importedResources);
  }
  /** Registers a pass and its explicit resource dependencies before compilation. */
  add(pass: RenderGraphPass<Context>): void {
    if (this.compiled) throw new Error("Cannot mutate compiled render graph");
    if (
      this.passes.some(
        (p) =>
          /** Evaluates the p.name === pass.name condition. */ p.name ===
          pass.name,
      )
    )
      throw new Error("Duplicate render pass");
    this.passes.push(
      Object.freeze({
        ...pass,
        reads: Object.freeze([...pass.reads]),
        writes: Object.freeze([...pass.writes]),
        dependsOn: pass.dependsOn
          ? Object.freeze([...pass.dependsOn])
          : undefined,
      }),
    );
  }
  /** Validates unique producers/dependencies and builds a stable topological execution order. */
  compile(): void {
    if (this.compiled) return;
    const producers = new Map<string, number>(),
      names = new Map(
        this.passes.map(
          (
            p,
            i,
          ) => /** Returns the ordered values needed by this operation. */ [
            p.name,
            i,
          ],
        ),
      );
    for (let i = 0; i < this.passes.length; i++)
      for (const resource of this.passes[i]!.writes) {
        if (producers.has(resource))
          throw new Error(
            `Multiple writers for ${resource}; use explicit resource versions`,
          );
        producers.set(resource, i);
      }
    const dependencies = this.passes.map((pass, index) => {
      // Collects explicit and resource-producer prerequisites for this pass, rejecting invalid dependencies.

      const ids = new Set<number>();
      for (const name of pass.dependsOn ?? []) {
        const id = names.get(name);
        if (id === undefined) throw new Error(`Unknown dependency ${name}`);
        ids.add(id);
      }
      for (const resource of pass.reads) {
        const id = producers.get(resource);
        if (id === undefined) {
          if (!this.imported.has(resource))
            throw new Error(`Uninitialized resource ${resource}`);
        } else if (id === index)
          throw new Error(
            `Feedback resource ${resource} requires explicit versions`,
          );
        else ids.add(id);
      }
      return ids;
    });
    const scheduled = new Set<number>();
    this.schedule.length = 0;
    while (this.schedule.length < this.passes.length) {
      let progressed = false;
      for (let i = 0; i < this.passes.length; i++)
        if (
          !scheduled.has(i) &&
          Array.from(dependencies[i]!).every((id) =>
            /** Delegates this operation to scheduled.has. */ scheduled.has(id),
          )
        ) {
          scheduled.add(i);
          this.schedule.push(this.passes[i]!);
          progressed = true;
        }
      if (!progressed) {
        this.schedule.length = 0;
        throw new Error("Render graph dependency cycle");
      }
    }
    const lifetimes = new Map<string, ResourceLifetime>();
    for (let index = 0; index < this.schedule.length; index++) {
      const pass = this.schedule[index]!;
      for (const name of [...pass.reads, ...pass.writes]) {
        const previous = lifetimes.get(name),
          imported = this.imported.has(name);
        lifetimes.set(
          name,
          Object.freeze({
            name,
            first: previous?.first ?? (imported ? -1 : index),
            last: this.textures.get(name)?.exported
              ? this.schedule.length
              : index,
            imported,
            exported: this.textures.get(name)?.exported ?? false,
          }),
        );
      }
    }
    try {
      this.targetPlan = planTargets(lifetimes, this.textures);
    } catch (error) {
      this.schedule.length = 0;
      throw error;
    }
    this.resourceLifetimes.clear();
    for (const [name, lifetime] of lifetimes)
      this.resourceLifetimes.set(name, lifetime);
    this.publishedOrder = Object.freeze([...this.schedule]);
    this.compiled = true;
  }
  /** Invokes the retained compiled pass callbacks with the current encoder and presentation target. */
  execute(encoder: GPUCommandEncoder, context: Context): void {
    if (!this.compiled)
      throw new Error("Compile render graph before execution");
    for (let i = 0; i < this.schedule.length; i++)
      this.schedule[i]!.execute(encoder, context);
  }
}
