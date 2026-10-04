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
  readonly order: RenderGraphPass<Context>[] = [];
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
    this.passes.push(pass);
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
    this.order.length = 0;
    while (this.order.length < this.passes.length) {
      let progressed = false;
      for (let i = 0; i < this.passes.length; i++)
        if (
          !scheduled.has(i) &&
          Array.from(dependencies[i]!).every((id) =>
            /** Delegates this operation to scheduled.has. */ scheduled.has(id),
          )
        ) {
          scheduled.add(i);
          this.order.push(this.passes[i]!);
          progressed = true;
        }
      if (!progressed) {
        this.order.length = 0;
        throw new Error("Render graph dependency cycle");
      }
    }
    this.compiled = true;
  }
  /** Invokes the retained compiled pass callbacks with the current encoder and presentation target. */
  execute(encoder: GPUCommandEncoder, context: Context): void {
    if (!this.compiled)
      throw new Error("Compile render graph before execution");
    for (let i = 0; i < this.order.length; i++)
      this.order[i]!.execute(encoder, context);
  }
}
