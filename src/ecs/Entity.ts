export type Entity = number;

/** Persistent identity for a recyclable slot. Resolve immediately before accessing SoA arrays. */
export interface EntityHandle {
  readonly index: number;
  readonly generation: number;
}
