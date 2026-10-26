import type { IndexedGraph } from '../domain/graph';

/**
 * A selected-edge property. Adding a property means adding one module that implements this
 * interface, registering it, and adding fixtures.
 */
export interface GraphProperty {
  readonly id: string;
  /** Display name, e.g. `Path`. */
  readonly name: string;
  /** Noun used in messages, e.g. `path` in "Source must be a valid path". */
  readonly noun: string;
  readonly allowsEmpty: boolean;
  /** Pure and deterministic. */
  isValid(mask: number, graph: IndexedGraph): boolean;
  /** Null when valid; otherwise a short reason such as `vertex B has degree 3`. */
  explainInvalid(mask: number, graph: IndexedGraph): string | null;
}

/** Largest meaningful budget for a configuration size q (§3.5). */
export function maxBudget(property: Pick<GraphProperty, 'allowsEmpty'>, q: number): number {
  if (q <= 0) return 0;
  return property.allowsEmpty ? q : q - 1;
}
