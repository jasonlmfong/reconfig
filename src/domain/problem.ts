import type { Graph } from './graph';
import type { MoveModelId } from './moveModel';

export type PropertyId = 'path' | 'tree' | 'cycle' | 'forest';

export const PROPERTY_IDS: readonly PropertyId[] = ['path', 'tree', 'cycle', 'forest'];

export type SelectionRole = 'source' | 'target';

/** A reconfiguration problem instance (no solver result, no presentation state). */
export interface Problem {
  graph: Graph;
  property: PropertyId;
  /** Omitted by schema-v1 projects and older callers; defaults to Token Jumping. */
  moveModel?: MoveModelId;
  sourceEdgeIds: string[];
  targetEdgeIds: string[];
}

/** Sorts selected edge IDs into canonical edge order and drops unknown IDs. */
export function canonicalSelection(ids: Iterable<string>, graph: Graph): string[] {
  const wanted = new Set(ids);
  return graph.edges.filter((e) => wanted.has(e.id)).map((e) => e.id);
}

/**
 * Fingerprint of everything that determines a solve: topology, canonical edge order,
 * property, move model, and selections. Labels and positions are deliberately excluded.
 */
export function problemFingerprint(problem: Problem): string {
  return JSON.stringify({
    v: problem.graph.vertices.map((v) => v.id),
    e: problem.graph.edges.map((e) => [e.id, e.u, e.v]),
    p: problem.property,
    m: problem.moveModel ?? 'token-jumping',
    s: canonicalSelection(problem.sourceEdgeIds, problem.graph),
    t: canonicalSelection(problem.targetEdgeIds, problem.graph),
  });
}
